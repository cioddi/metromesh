import { useState } from 'react';
import attributionsData from '../data/attributions.json';

interface Contributor {
  name: string;
  description: string;
  'github-url': string;
  img?: string;
}

interface Attribution {
  name: string;
  img: string;
  description: string;
  url: string;
  contributors: Contributor[];
}

interface AttributionPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AttributionPopup({ isOpen, onClose }: AttributionPopupProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  
  const attributions: Attribution[] = attributionsData;

  const toggleProject = (projectName: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectName)) {
      newExpanded.delete(projectName);
    } else {
      newExpanded.add(projectName);
    }
    setExpandedProjects(newExpanded);
  };

  if (!isOpen) return null;

  return (
    <div className="attribution-overlay">
      <div className="attribution-popup">
        <div className="attribution-header">
          <h2 className="attribution-title">Attributions</h2>
          <button 
            className="close-btn" 
            onClick={onClose}
            onTouchStart={() => {}} // Enable touch events
          >
            ×
          </button>
        </div>
        
        <div className="attribution-content">
          <p className="attribution-intro">
            MetroMesh is built with amazing open source projects and data sources.
          </p>
          
          <div className="projects-list">
            {attributions.map((project) => (
              <div key={project.name} className="project-item">
                <div 
                  className="project-header" 
                  onClick={() => toggleProject(project.name)}
                  onTouchStart={() => {}} // Enable touch events
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleProject(project.name);
                    }
                  }}
                >
                  <div className="project-info">
                    <img 
                      src={'/metromesh' + project.img} 
                      alt={`${project.name} logo`} 
                      className="project-logo"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                    <div className="project-details">
                      <h3 className="project-name">{project.name}</h3>
                      <p className="project-description">{project.description}</p>
                    </div>
                  </div>
                  <div className="expand-icon" aria-label={expandedProjects.has(project.name) ? 'Collapse' : 'Expand'}>
                    {expandedProjects.has(project.name) ? '−' : '+'}
                  </div>
                </div>
                
                {expandedProjects.has(project.name) && (
                  <div className="project-expanded">
                    <div className="project-url">
                      <strong>Website:</strong>{' '}
                      <a href={project.url} target="_blank" rel="noopener noreferrer">
                        {project.url}
                      </a>
                    </div>
                    
                    {project.contributors.length > 0 && (
                      <div className="contributors-section">
                        <strong>Contributors:</strong>
                        <ul className="contributors-list">
                          {project.contributors.map((contributor, index) => (
                            <li key={index} className="contributor-item">
                              <div className="contributor-main">
                                {contributor.img && (
                                  <img 
                                    src={'/metromesh' + contributor.img} 
                                    alt={`${contributor.name} avatar`} 
                                    className="contributor-avatar"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.style.display = 'none';
                                    }}
                                  />
                                )}
                                <div className="contributor-info">
                                  <span className="contributor-name">{contributor.name}</span>
                                  {contributor.description && (
                                    <span className="contributor-description">{contributor.description}</span>
                                  )}
                                </div>
                              </div>
                              <a 
                                href={contributor['github-url']} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="github-link"
                              >
                                GitHub
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}