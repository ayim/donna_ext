// Import Pinecone config
import { PINECONE_CONFIG } from '../config/keys.js';

document.addEventListener('DOMContentLoaded', function() {
  // Create main container
  const mainContainer = document.createElement('div');
  mainContainer.className = 'container';
  document.body.appendChild(mainContainer);

  // Create tabs container
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'tabs-container';
  
  const tabsHeader = document.createElement('h2');
  tabsHeader.textContent = 'Active Tabs';
  
  const tabsList = document.createElement('div');
  tabsList.id = 'tabsList';
  tabsList.className = 'tabs-list';
  
  tabsContainer.appendChild(tabsHeader);
  tabsContainer.appendChild(tabsList);
  mainContainer.appendChild(tabsContainer);

  // Create API requests container
  const apiRequestsContainer = document.createElement('div');
  apiRequestsContainer.className = 'api-requests-container';
  
  const apiHeader = document.createElement('h2');
  apiHeader.textContent = 'API Requests';
  
  const apiRequestsList = document.createElement('div');
  apiRequestsList.id = 'apiRequestsList';
  apiRequestsList.className = 'api-requests-list';
  
  apiRequestsContainer.appendChild(apiHeader);
  apiRequestsContainer.appendChild(apiRequestsList);
  mainContainer.appendChild(apiRequestsContainer);

  // Function to format timestamp
  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  // Function to render tabs
  function renderTabs() {
    chrome.tabs.query({}, function(tabs) {
      // Get all access times and Pinecone statuses first
      const tabIds = tabs.map(tab => `tab_${tab.id}_access`);
      const statusIds = tabs.map(tab => `tab_${tab.id}_pinecone_status`);
      const allIds = [...tabIds, ...statusIds];
      
      chrome.storage.local.get(allIds, function(data) {
        tabsList.innerHTML = '';
        tabs.forEach(function(tab) {
          const tabElement = document.createElement('div');
          tabElement.className = 'tab-item';
          
          const accessTime = data[`tab_${tab.id}_access`];
          const pineconeStatus = data[`tab_${tab.id}_pinecone_status`];
          
          // If no Pinecone status exists, send to Pinecone
          if (!pineconeStatus) {
            sendToPinecone(tab);
          }
          
          tabElement.innerHTML = `
            <div class="tab-title">${tab.title}</div>
            <div class="tab-url">${tab.url}</div>
            <div class="tab-access-time">
              ${accessTime ? `Last accessed: ${formatTime(accessTime)}` : 'No access time recorded'}
            </div>
            <div class="tab-status ${pineconeStatus ? (pineconeStatus.success ? 'status-success' : 'status-error') : 'status-pending'}">
              ${pineconeStatus ? pineconeStatus.message : 'Not sent to Pinecone'}
              ${pineconeStatus?.success ? `<button class="delete-btn" data-id="tab_${tab.id}">Delete from Pinecone</button>` : ''}
            </div>
          `;
          
          // Add click handler to focus the tab
          tabElement.addEventListener('click', function() {
            chrome.tabs.update(tab.id, { active: true });
            chrome.windows.update(tab.windowId, { focused: true });
            
            // Record access time
            const accessData = {
              [`tab_${tab.id}_access`]: Date.now()
            };
            chrome.storage.local.set(accessData);
            
            // Send to Pinecone
            sendToPinecone(tab);
          });
          
          // Add delete button click handler
          const deleteBtn = tabElement.querySelector('.delete-btn');
          if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
              e.stopPropagation(); // Prevent tab focus
              const id = e.target.dataset.id;
              console.log('Starting tab deletion process:', { id });
              
              // Log the current storage state
              chrome.storage.local.get(null, (data) => {
                console.log('Current storage before deletion:', 
                  Object.keys(data).filter(key => key.includes(id))
                );
              });
              
              await deleteFromPinecone(id, id);
            });
          }
          
          tabsList.appendChild(tabElement);
        });
      });
    });
  }

  // Function to send tab data to Pinecone
  async function sendToPinecone(tab) {
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
      renderTabs();
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
      renderTabs();
    }
  }

  // Function to render API requests
  function renderApiRequests() {
    chrome.storage.local.get(null, function(data) {
      apiRequestsList.innerHTML = '';
      
      const apiRequests = Object.entries(data)
        .filter(([key, value]) => value.isApiRequest);
      
      if (apiRequests.length === 0) {
        apiRequestsList.innerHTML = '<div class="no-requests">No API requests captured yet</div>';
        return;
      }
      
      apiRequests
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, 10)
        .forEach(([key, request]) => {
          if (!request.payload || !request.payload.info) return;
          
          const infoArray = request.payload.info;
          const subredditInfo = infoArray.find(event => event.subreddit)?.subreddit;
          
          const relevantEvents = infoArray.filter(event => 
            event.noun === 'save' || 
            event.noun === 'upvote' || 
            event.noun === 'downvote' ||
            (event.action === 'click' && event.noun === 'save')
          );
          
          relevantEvents.forEach(event => {
            const requestElement = document.createElement('div');
            requestElement.className = 'api-request-item';
            
            try {
              const actionType = (event.action === 'click' && event.noun === 'save') ? 'save' : event.noun;
              const {
                post: { url, nsfw }
              } = event;
              
              const subredditName = event.subreddit?.name || subredditInfo?.name || 'unknown';
              const pineconeStatus = data[`reddit_${request.timestamp}_${actionType}_pinecone_status`];
              
              requestElement.innerHTML = `
                <div class="request-action ${actionType.toLowerCase()}">
                  ${actionType.toUpperCase()}
                </div>
                <div class="request-details">
                  <div class="request-subreddit">r/${subredditName}</div>
                  <div class="request-url">Post URL: ${event.post.url}</div>
                  <div class="request-canonical-url">Canonical URL: ${event.request?.canonical_url || 'N/A'}</div>
                  <div class="request-nsfw">${nsfw ? '🔞 NSFW' : '✅ SFW'}</div>
                  <div class="tab-status ${pineconeStatus ? (pineconeStatus.success ? 'status-success' : 'status-error') : 'status-pending'}">
                    ${pineconeStatus ? pineconeStatus.message : 'Not sent to Pinecone'}
                    ${pineconeStatus?.success ? `<button class="delete-btn" data-id="reddit_${request.timestamp}_${actionType}">Delete from Pinecone</button>` : ''}
                  </div>
                </div>
                <div class="request-time">${formatTime(request.timestamp)}</div>
              `;
              
              // Add delete button click handler
              const deleteBtn = requestElement.querySelector('.delete-btn');
              if (deleteBtn) {
                deleteBtn.addEventListener('click', async () => {
                  await deleteFromPinecone(deleteBtn.dataset.id, `reddit_${request.timestamp}_${actionType}`);
                });
              }
              
              apiRequestsList.appendChild(requestElement);
            } catch (error) {
              console.error('Error processing event:', error);
            }
          });
        });
    });
  }

  // Initial renders
  renderTabs();
  renderApiRequests();

  // Listen for storage changes and tab updates
  chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local') {
      renderApiRequests();
      renderTabs();
    }
  });

  // Listen for tab updates and send to Pinecone when URL changes
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only process when URL changes and loading is complete
    if (changeInfo.url || (changeInfo.status === 'complete' && tab.url)) {
      sendToPinecone(tab);
      
      // Record access time
      const accessData = {
        [`tab_${tabId}_access`]: Date.now()
      };
      chrome.storage.local.set(accessData);
    }
  });

  // Remove the old onUpdated listener since we have it outside now
  chrome.tabs.onRemoved.addListener(renderTabs);
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

// Update the delete function
async function deleteFromPinecone(id, type) {
  try {
    console.log('Deleting from Pinecone:', { id, type });
    
    // Log the exact request we're sending
    const deleteRequest = {
      method: 'POST',
      headers: {
        'Api-Key': PINECONE_CONFIG.API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        namespace: '', // Add empty namespace
        ids: [id],
        deleteAll: false // Add deleteAll parameter
      })
    };
    console.log('Delete request:', deleteRequest);
    
    const response = await fetch(
      `https://${PINECONE_CONFIG.HOST}/vectors/delete`,
      deleteRequest
    );

    const responseText = await response.text();
    console.log('Delete response:', {
      status: response.status,
      text: responseText,
      headers: Object.fromEntries(response.headers)
    });

    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.status} ${responseText}`);
    }

    // Check storage before removal
    const beforeStorage = await chrome.storage.local.get(null);
    console.log('Storage before removal:', 
      Object.keys(beforeStorage).filter(key => key.includes(id))
    );

    // Use consistent status key format
    const statusKey = `${id}_pinecone_status`;
    console.log('Attempting to remove status key:', statusKey);
    await chrome.storage.local.remove(statusKey);

    // Check storage after removal
    const afterStorage = await chrome.storage.local.get(null);
    console.log('Storage after removal:', 
      Object.keys(afterStorage).filter(key => key.includes(id))
    );
    
    // Re-render the UI
    renderTabs();
    renderApiRequests();

    return true;
  } catch (error) {
    console.error('Error deleting from Pinecone:', error);
    return false;
  }
} 