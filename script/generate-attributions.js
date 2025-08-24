#!/usr/bin/env node
/**
 * Generate attribution data for dependencies
 * 
 * Usage:
 *   node script/generate-attributions.js
 * 
 * With GitHub token (recommended to avoid rate limits):
 *   GITHUB_TOKEN=your_token_here node script/generate-attributions.js
 * 
 * The script will:
 * 1. Read package.json dependencies
 * 2. Fetch repo info from npm registry
 * 3. Get contributor stats from GitHub API
 * 4. Download project logos and contributor avatars
 * 5. Generate src/data/attributions.json
 * 
 * Rate limiting mitigation:
 * - Exponential backoff on failures
 * - Automatic rate limit detection and waiting
 * - User-Agent header for better API treatment
 * - 100ms delays between requests
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PKG_PATH = path.join(__dirname, "../package.json");
const OUTPUT_FILE = path.join(__dirname, "../src/data/attributions.json");
const LOGO_DIR = path.join(__dirname, "../public/attributions");
const CONTRIB_DIR = path.join(LOGO_DIR, "contributors");

fs.mkdirSync(LOGO_DIR, { recursive: true });
fs.mkdirSync(CONTRIB_DIR, { recursive: true });

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
const deps = Object.keys(pkg.dependencies || {});

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function fetchJson(url, retries = 3) {
  const headers = {
    "User-Agent": "metromesh-attribution-generator",
  };
  
  if (GITHUB_TOKEN && url.includes("api.github.com")) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }
  
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers });
      
      if (res.status === 202) {
        if (i === retries - 1) {
          console.log(`  Stats still not ready after ${retries} attempts: ${url}`);
          return [];
        }
        
        const waitTime = Math.min(5000 * (i + 1), 15000); // 5s, 10s, 15s max
        console.log(`  Stats not ready yet, waiting ${waitTime / 1000}s before retry ${i + 1}/${retries}: ${url}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue; // Retry without counting as an error
      }
      
      if (res.status === 403) {
        const resetHeader = res.headers.get('x-ratelimit-reset');
        const remaining = res.headers.get('x-ratelimit-remaining');
        
        if (remaining === '0' && resetHeader) {
          const resetTime = new Date(parseInt(resetHeader) * 1000);
          const waitTime = Math.max(0, resetTime.getTime() - Date.now() + 5000); // Add 5s buffer
          console.log(`  Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s until ${resetTime.toLocaleTimeString()}`);
          
          if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue; // Retry after waiting
          }
        }
        
        console.log(`  403 Forbidden for ${url}. ${GITHUB_TOKEN ? 'Token may need more permissions.' : 'Consider setting GITHUB_TOKEN.'}`);
        throw new Error(`403 Forbidden: ${url}`);
      }
      
      if (!res.ok) {
        throw new Error(`Failed ${url}: ${res.status} ${res.statusText}`);
      }
      
      return res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      
      const delay = Math.pow(2, i) * 1000; // Exponential backoff: 1s, 2s, 4s
      console.log(`  Retry ${i + 1}/${retries} for ${url} in ${delay}ms (${err.message})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) return;
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(buffer));
}

function guessRepoFromGithubIo(ghio, depName) {
  const match = ghio.match(/https:\/\/([^.]+)\.github\.io/);
  if (!match) return null;
  const user = match[1];
  return `https://github.com/${user}/${depName.replace(/^@/, "").replace(/\//g, "-")}`;
}

function cleanDescription(text, fallbackDescription = "") {
  if (!text) return fallbackDescription;
  
  let out = text;
  
  // First pass: Remove all badge-like patterns more aggressively
  // Remove any line that looks like badges (starts with [ or [![)
  out = out.replace(/^[\[\s]*\[!\[[^\]]*\].*$/gm, ""); // Lines starting with [![
  out = out.replace(/^[\[\s]*!\[[^\]]*\].*$/gm, ""); // Lines starting with ![
  
  // Remove all remaining badge patterns
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // ![alt](url)
  out = out.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ""); // [![alt](badge)](link)  
  out = out.replace(/\[!\[[^\]]*\]\([^)]*\)\]/g, ""); // [![alt](badge)]
  
  // Remove empty markdown links: [](...) or [](...)
  out = out.replace(/\[\s*\]\([^)]*\)/g, "");
  
  // Remove HTML tags completely
  out = out.replace(/<[^>]*>/g, "");
  
  // Remove markdown headers (# ## ###)
  out = out.replace(/^#+\s*/gm, "");
  
  // Remove code blocks and inline code
  out = out.replace(/```[\s\S]*?```/g, "");
  out = out.replace(/`[^`\n]+`/g, "");
  
  // Remove horizontal rules
  out = out.replace(/^[-*_]{3,}$/gm, "");
  
  // Remove table syntax
  out = out.replace(/\|[^|\n]*\|/g, "");
  
  // Remove reference-style link definitions: [label]: url
  out = out.replace(/^\[[^\]]+\]:\s*\S+.*$/gm, "");
  
  // Convert remaining markdown links to just text: [text](url) -> text
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  
  // Clean up excessive whitespace
  out = out.replace(/\r?\n|\r/g, " ");
  out = out.replace(/\s+/g, " ");
  out = out.trim();
  
  // Remove any remaining brackets or parentheses that are likely badge remnants
  out = out.replace(/\[\s*\]/g, ""); // Empty brackets []
  out = out.replace(/\(\s*\)/g, ""); // Empty parentheses ()
  
  // If we still don't have meaningful content, use fallback
  if (!out || out.length < 15 || out.match(/^[[\]().\s]*$/)) {
    return fallbackDescription;
  }
  
  // Split into sentences and find the first real descriptive content
  const sentences = out.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
  
  let result = "";
  for (const sentence of sentences) {
    // Skip sentences that are just fragments, single words, or look like leftovers
    if (sentence.length < 10 || 
        sentence.split(/\s+/).length < 3 || 
        sentence.match(/^(npm|github|build|test|license|version|download)/i)) {
      continue;
    }
    
    const potential = result + (result ? ". " : "") + sentence;
    if (potential.length > 200) break;
    result = potential;
    
    // Stop after we get a good first sentence
    if (!result.includes(".") && sentence.length > 20) {
      result = sentence;
      break;
    }
  }
  
  // Clean up the result
  result = result.trim();
  if (result && !result.endsWith(".")) {
    result += ".";
  }
  
  // Final check: if we have good content, return it
  if (result && result.length >= 15 && result.split(/\s+/).length >= 3) {
    return result;
  }
  
  // Last resort: return fallback
  return fallbackDescription;
}

async function processDep(dep) {
  console.log(`Processing ${dep}...`);
  let repoUrl = "";
  let description = "";

  const meta = await fetchJson(`https://registry.npmjs.org/${dep}`);
  description = meta.description || "";

  // Step 1: repository.url
  repoUrl = meta.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") || "";

  // Step 2: homepage
  if (!repoUrl.includes("github.com") && meta.homepage?.includes("github.com")) {
    repoUrl = meta.homepage;
  }

  const readme = meta.readme || "";

  // Step 3: readme github.com link
  if (!repoUrl.includes("github.com")) {
    const gh = readme.match(/https:\/\/github\.com\/[^\s)]+/);
    if (gh) repoUrl = gh[0];
  }

  // Step 4: derive from *.github.io
  if (!repoUrl.includes("github.com")) {
    const ghio = readme.match(/https:\/\/[a-zA-Z0-9-]+\.github\.io[^\s)]*/);
    if (ghio) {
      const guess = guessRepoFromGithubIo(ghio[0], dep);
      if (guess) repoUrl = guess;
    }
  }

  if (!repoUrl.includes("github.com")) {
    console.log(`  Skipping ${dep} (no GitHub repo)`);
    return null;
  }

  // Normalize
  const repoPath = repoUrl.replace(/.*github\.com\//, "").split(/[?#]/)[0];
  const [owner, repo] = repoPath.split("/");

  // Contributors by additions
  let contributors = [];
  try {
    // Add delay between API requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const stats = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/stats/contributors`,
      5 // More retries for stats endpoint since it often needs time to compute
    );

    const ranked = (Array.isArray(stats) ? stats : [])
      .map((s) => ({
        login: s.author?.login,
        url: s.author?.html_url,
        avatar: s.author?.avatar_url,
        additions: s.weeks.reduce((sum, w) => sum + w.a, 0),
      }))
      .filter((c) => c.login)
      .sort((a, b) => b.additions - a.additions)
      .slice(0, 8);

    contributors = await Promise.all(
      ranked.map(async (c) => {
        const avatarFile = path.join(CONTRIB_DIR, `${dep.replace("/", "_")}_${c.login}.png`);
        if (c.avatar) {
          await downloadFile(c.avatar, avatarFile);
        }
        return {
          name: c.login,
          description: "",
          "github-url": c.url || `https://github.com/${c.login}`,
          img: `/attributions/contributors/${path.basename(avatarFile)}`,
        };
      })
    );
  } catch (err) {
    console.log(`  Failed to fetch contributor stats for ${dep}: ${err.message}`);
  }

  // Project/org avatar
  let repoData;
  try {
    // Add delay between API requests
    await new Promise(resolve => setTimeout(resolve, 100));
    repoData = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`);
  } catch (err) {
    console.log(`  Failed to fetch repo data for ${dep}: ${err.message}`);
    repoData = {};
  }
  
  const logoFile = path.join(LOGO_DIR, `${dep.replace("/", "_")}.png`);
  if (repoData.owner?.avatar_url) {
    await downloadFile(repoData.owner.avatar_url, logoFile);
  }

  return {
    name: dep,
    img: `/attributions/${path.basename(logoFile)}`,
    description: cleanDescription(readme, description), // README first, package description as fallback
    url: `https://github.com/${owner}/${repo}`,
    contributors,
  };
}

(async function main() {
  const results = [];
  for (const dep of deps) {
    try {
      const attribution = await processDep(dep);
      if (attribution) results.push(attribution);
    } catch (err) {
      console.error(`Error with ${dep}:`, err.message);
    }
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`✅ Attribution data written to ${OUTPUT_FILE}`);
})();
