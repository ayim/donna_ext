// Import Pinecone config
import { PINECONE_CONFIG } from '../config/keys.js';

document.addEventListener('DOMContentLoaded', function() {
  // Create main container
  const mainContainer = document.createElement('div');
  mainContainer.className = 'container';
  
  // Add header with AI name
  const header = document.createElement('div');
  header.className = 'header';
  header.innerHTML = `
    <div class="ai-title">
      <div class="title-group">
        <img src="icons/notion-avatar-1739246648562.png" class="ai-logo" alt="Donna AI Logo">
        <div class="title-text">
          <h1>Donna AI</h1>
          <p class="subtitle">Because an assistant should know what you need—even before you do.</p>
        </div>
      </div>
    </div>
  `;
  mainContainer.appendChild(header);

  // Create unified activity list container
  const activityContainer = document.createElement('div');
  activityContainer.className = 'activity-container';

  const activityHeader = document.createElement('div');
  activityHeader.className = 'activity-header';
  activityHeader.innerHTML = `
    <h2>Recent Activity</h2>
    <div class="header-actions">
      <button class="projects-btn" id="projectsBtn">Projects</button>
      <div class="pinecone-toggle">
        <label class="switch">
          <input type="checkbox" id="pineconeToggle" checked>
          <span class="slider round"></span>
        </label>
        <span class="toggle-label">On</span>
      </div>
    </div>
  `;

  const activityList = document.createElement('div');
  activityList.id = 'activityList';
  activityList.className = 'activity-list';

  activityContainer.appendChild(activityHeader);
  activityContainer.appendChild(activityList);
  mainContainer.appendChild(activityContainer);

  // Add the main container to the document body
  document.body.appendChild(mainContainer);

  // Function to format timestamp
  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  // Function to render activity
  async function renderActivity() {
    const activityList = document.getElementById('activityList');
    activityList.innerHTML = '';

    // Get all data from storage
    const data = await chrome.storage.local.get(null);
    const tabs = await chrome.tabs.query({});

    // Prepare tabs data
    const tabsData = tabs.map(tab => ({
      type: 'tab',
      timestamp: data[`tab_${tab.id}_access`] || Date.now(),
      data: tab,
      pineconeStatus: data[`tab_${tab.id}_pinecone_status`]
    }));

    // Prepare API requests data
    const apiRequests = Object.entries(data)
      .filter(([key, value]) => value.isApiRequest)
      .flatMap(([key, request]) => {
        if (!request.payload?.info) return [];
        
        return request.payload.info
          .filter(event => 
            event.noun === 'save' || 
            event.noun === 'upvote' || 
            event.noun === 'downvote' ||
            (event.action === 'click' && event.noun === 'save')
          )
          .map(event => ({
            type: 'reddit',
            timestamp: request.timestamp,
            data: event,
            request: request,
            pineconeStatus: data[`reddit_${request.timestamp}_${event.noun}_pinecone_status`]
          }));
      });

    // Combine and sort all activities
    const allActivities = [...tabsData, ...apiRequests]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20); // Show last 20 activities

    // Render each activity
    allActivities.forEach(activity => {
      const element = document.createElement('div');
      element.className = 'activity-item';

      if (activity.type === 'tab') {
        const tab = activity.data;
        element.innerHTML = `
          <div class="activity-icon">🌐</div>
          <div class="activity-content">
            <div class="activity-title">${tab.title}</div>
            <div class="activity-url">${tab.url}</div>
            <div class="activity-time">${formatTime(activity.timestamp)}</div>
            <div class="tab-status ${activity.pineconeStatus?.isTemp ? 'temp-message' : ''} ${activity.pineconeStatus ? (activity.pineconeStatus.success ? 'status-success' : 'status-error') : 'status-pending'}">
              ${activity.pineconeStatus ? activity.pineconeStatus.message : 'Not sent to Pinecone'}
              ${activity.pineconeStatus?.success && !activity.pineconeStatus?.isTemp ? `<button class="delete-btn" data-id="tab_${tab.id}">Delete</button>` : ''}
            </div>
          </div>
        `;

        // Add tab click handler
        element.addEventListener('click', () => {
          chrome.tabs.update(tab.id, { active: true });
          chrome.windows.update(tab.windowId, { focused: true });
        });

      } else {
        const event = activity.data;
        const actionType = (event.action === 'click' && event.noun === 'save') ? 'save' : event.noun;
        const subredditName = event.subreddit?.name || 'unknown';

        element.innerHTML = `
          <div class="activity-icon ${actionType}">
            ${actionType === 'upvote' ? '⬆️' : actionType === 'downvote' ? '⬇️' : '💾'}
          </div>
          <div class="activity-content">
            <div class="activity-action">${actionType.toUpperCase()}</div>
            <div class="activity-subreddit">r/${subredditName}</div>
            <div class="activity-url">Post URL: ${event.post.url}</div>
            <div class="activity-canonical-url">Canonical URL: ${event.request?.canonical_url || 'N/A'}</div>
            <div class="activity-nsfw">${event.post.nsfw ? '🔞 NSFW' : '✅ SFW'}</div>
            <div class="activity-time">${formatTime(activity.timestamp)}</div>
            <div class="tab-status ${activity.pineconeStatus?.isTemp ? 'temp-message' : ''} ${activity.pineconeStatus ? (activity.pineconeStatus.success ? 'status-success' : 'status-error') : 'status-pending'}">
              ${activity.pineconeStatus ? activity.pineconeStatus.message : 'Not sent to Pinecone'}
              ${activity.pineconeStatus?.success && !activity.pineconeStatus?.isTemp ? `<button class="delete-btn" data-id="reddit_${activity.timestamp}_${actionType}">Delete</button>` : ''}
            </div>
          </div>
        `;
      }

      // Add delete button handlers
      const deleteBtn = element.querySelector('.delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = e.target.dataset.id;
          await deleteFromPinecone(id, id);
        });
      }

      activityList.appendChild(element);
    });
  }

  // Function to send tab data to Pinecone
  async function sendToPinecone(tab) {
    // Check if Pinecone integration is enabled
    const { pineconeEnabled } = await chrome.storage.local.get('pineconeEnabled');
    if (pineconeEnabled === false) {
      console.log('Pinecone integration is disabled');
      return;
    }

    try {
      const dummyVector = new Array(PINECONE_CONFIG.DIMENSION).fill(0.1);
      const vectorId = `tab_${tab.id}`; // This is the ID we'll use for deletion
      const statusKey = `${vectorId}_pinecone_status`; // Consistent status key format

      const response = await fetch(
        `https://${PINECONE_CONFIG.HOST}/vectors/upsert`,
        {
          method: 'POST',
          headers: {
            'Api-Key': PINECONE_CONFIG.API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            vectors: [{
              id: vectorId,
              values: dummyVector,
              metadata: {
                type: 'tab',
                title: tab.title,
                url: tab.url,
                timestamp: Date.now()
              }
            }]
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Pinecone error response:', errorText);
        throw new Error(`Failed to upsert: ${response.status}`);
      }

      const result = await response.json();
      console.log('Pinecone upsert result:', result);

      const statusData = {
        [statusKey]: { // Use consistent status key
          success: true,
          message: 'Successfully sent to Pinecone',
          timestamp: Date.now()
        }
      };
      
      chrome.storage.local.set(statusData);
      renderActivity();
    } catch (error) {
      console.error('Pinecone error:', error);
      const errorData = {
        [`tab_${tab.id}_pinecone_status`]: {
          success: false,
          message: `Error: ${error.message}`,
          timestamp: Date.now()
        }
      };
      
      chrome.storage.local.set(errorData);
      renderActivity();
    }
  }

  // Update event listeners to use new render function
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      renderActivity();
    }
  });

  // Update the tab update listener
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Send to Pinecone when a page loads or URL changes
    if (changeInfo.status === 'complete' && tab.url) {
      console.log('Tab completed loading:', { tabId, url: tab.url });
      
      // Record access time
      const accessData = {
        [`tab_${tabId}_access`]: Date.now()
      };
      chrome.storage.local.set(accessData);

      // Send to Pinecone
      sendToPinecone(tab);
      renderActivity();
    }
    // Also send when URL changes (for single page apps)
    else if (changeInfo.url) {
      console.log('Tab URL changed:', { tabId, url: changeInfo.url });
      
      // Record access time
      const accessData = {
        [`tab_${tabId}_access`]: Date.now()
      };
      chrome.storage.local.set(accessData);

      // Send to Pinecone
      sendToPinecone(tab);
      renderActivity();
    }
  });

  chrome.tabs.onRemoved.addListener(renderActivity);

  // Initial render
  renderActivity();

  // Add toggle functionality
  const pineconeToggle = document.getElementById('pineconeToggle');
  chrome.storage.local.get('pineconeEnabled', (data) => {
    pineconeToggle.checked = data.pineconeEnabled !== false; // Default to true if not set
  });

  pineconeToggle.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ pineconeEnabled: enabled });
  });

  // Add the click handler for the projects button
  document.getElementById('projectsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.notion.so/your-projects-page' });
  });
});

// Listener for API requests
chrome.webRequest.onBeforeRequest.addListener(
  async function(details) {
    // Only process requests to the specific Reddit events endpoint
    if (!details.url.includes('https://www.reddit.com/svc/shreddit/events')) {
      return;
    }

    // Create a unique key for this request
    const requestKey = `reddit_event_${Date.now()}`;
    
    // Get the request body
    let requestBody = null;
    if (details.requestBody) {
      if (details.requestBody.raw) {
        // Handle raw data
        const encoder = new TextDecoder('utf-8');
        requestBody = encoder.decode(details.requestBody.raw[0].bytes);
        try {
          requestBody = JSON.parse(requestBody); // Parse if it's JSON

          // Send relevant events to Pinecone
          if (requestBody.info) {
            const relevantEvents = requestBody.info.filter(event => 
              event.noun === 'save' || 
              event.noun === 'upvote' || 
              event.noun === 'downvote' ||
              (event.action === 'click' && event.noun === 'save')
            );

            console.log('Found relevant events:', relevantEvents);

            for (const event of relevantEvents) {
              try {
                const actionType = (event.action === 'click' && event.noun === 'save') ? 'save' : event.noun;
                const subredditName = event.subreddit?.name || 
                                    requestBody.info.find(e => e.subreddit)?.subreddit?.name || 
                                    'unknown';

                console.log('Sending to Pinecone:', {
                  actionType,
                  subredditName,
                  url: event.post.url,
                  canonical_url: event.request?.canonical_url
                });

                // Get canonical URL from request info
                const canonicalUrl = event.request?.canonical_url || event.post.url;

                // Create vector for Pinecone
                const dummyVector = new Array(PINECONE_CONFIG.DIMENSION).fill(0.1);

                // Send to Pinecone
                const response = await fetch(
                  `https://${PINECONE_CONFIG.HOST}/vectors/upsert`,
                  {
                    method: 'POST',
                    headers: {
                      'Api-Key': PINECONE_CONFIG.API_KEY,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      vectors: [{
                        id: `reddit_${Date.now()}_${actionType}`,
                        values: dummyVector,
                        metadata: {
                          type: 'reddit_action',
                          action: actionType,
                          subreddit: subredditName,
                          url: event.post.url,
                          canonical_url: event.request?.canonical_url || null,
                          title: event.post.title,
                          nsfw: event.post.nsfw,
                          timestamp: Date.now()
                        }
                      }]
                    })
                  }
                );

                console.log('Pinecone response status:', response.status);
                if (!response.ok) {
                  const errorText = await response.text();
                  console.error('Pinecone error response:', errorText);
                } else {
                  console.log('Successfully sent to Pinecone');
                }

                // Update the Pinecone status in the API request listener
                const statusKey = `reddit_${Date.now()}_${actionType}_pinecone_status`;
                const statusData = {
                  [statusKey]: {
                    success: true,
                    message: 'Successfully sent to Pinecone',
                    timestamp: Date.now()
                  }
                };
                chrome.storage.local.set(statusData);
              } catch (error) {
                console.error('Error sending Reddit event to Pinecone:', error);

                // And for errors:
                const errorData = {
                  [statusKey]: {
                    success: false,
                    message: `Error: ${error.message}`,
                    timestamp: Date.now()
                  }
                };
                chrome.storage.local.set(errorData);
              }
            }
          }
        } catch (e) {
          // Keep as string if not valid JSON
        }
      } else if (details.requestBody.formData) {
        // Handle form data
        requestBody = details.requestBody.formData;
      }
    }
    
    // Store the request details
    const requestData = {
      isApiRequest: true,
      url: details.url,
      method: details.method,
      payload: requestBody,
      timestamp: Date.now()
    };

    // Store in chrome.storage.local
    chrome.storage.local.set({ [requestKey]: requestData });
  },
  { urls: ["https://www.reddit.com/svc/shreddit/events*"] },
  ["requestBody"]
);

// Add an array of Donna quotes for deletion
const DONNA_DELETE_QUOTES = [
  "Consider it gone. Like that time Harvey tried casual Fridays.",
  "I've made that disappear faster than Harvey's ego after losing a case.",
  "Done and done. Now that's what I call getting rid of evidence.",
  "Poof! Gone like Mike's fake Harvard degree.",
  "Memory deleted. Just like I delete Harvey's blind dates from his calendar.",
  "That's been handled. Because that's what I do.",
  "Consider it shredded. Like the time Louis tried to grow a beard.",
  "Gone. And unlike Rachel's cooking, this won't come back to haunt you.",
  "I've taken care of that. Just like I take care of everything else around here."
];

// Update the deleteFromPinecone function
async function deleteFromPinecone(id, type) {
  try {
    console.log('Deleting from Pinecone:', { id, type });
    
    const response = await fetch(
      `https://${PINECONE_CONFIG.HOST}/vectors/delete`,
      {
        method: 'POST',
        headers: {
          'Api-Key': PINECONE_CONFIG.API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          namespace: '',
          ids: [id],
          deleteAll: false
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.status}`);
    }

    // Get a random Donna quote
    const randomQuote = DONNA_DELETE_QUOTES[Math.floor(Math.random() * DONNA_DELETE_QUOTES.length)];

    // Use consistent status key format
    const statusKey = `${id}_pinecone_status`;
    await chrome.storage.local.remove(statusKey);
    
    // Show the quote in a temporary status message
    const tempStatusData = {
      [statusKey]: {
        success: true,
        message: randomQuote,
        timestamp: Date.now(),
        isTemp: true
      }
    };
    chrome.storage.local.set(tempStatusData);
    
    // Re-render immediately to show the quote
    renderActivity();

    // Remove the temporary message after 3 seconds
    setTimeout(() => {
      chrome.storage.local.remove(statusKey);
      renderActivity();
    }, 3000);

    return true;
  } catch (error) {
    console.error('Error deleting from Pinecone:', error);
    return false;
  }
} 