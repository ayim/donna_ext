document.addEventListener('DOMContentLoaded', function() {
  const tabsList = document.getElementById('tabsList');
  const redditActionsList = document.getElementById('redditActionsList');
  const apiRequestsList = document.createElement('div');
  apiRequestsList.id = 'apiRequestsList';
  document.body.appendChild(apiRequestsList);

  // Add API Requests section header
  const apiHeader = document.createElement('h2');
  apiHeader.textContent = 'API Requests';
  apiRequestsList.before(apiHeader);

  // Function to format timestamp
  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  // Function to render Reddit actions
  function renderRedditActions() {
    chrome.storage.local.get(null, function(data) {
      redditActionsList.innerHTML = '';
      
      // Filter for Reddit action entries
      Object.entries(data)
        .filter(([key, value]) => value.isRedditAction)
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .forEach(([key, action]) => {
          const actionElement = document.createElement('div');
          actionElement.className = 'reddit-action-item';
          
          const titleElement = document.createElement('div');
          titleElement.className = 'reddit-action-title';
          titleElement.textContent = action.postTitle || 'Reddit Post';
          
          const detailsElement = document.createElement('div');
          detailsElement.innerHTML = `
            <span class="reddit-action-subreddit">r/${action.subreddit}</span>
            <span class="reddit-action-type action-${action.action}">${action.action}</span>
            <div class="tab-status ${action.success ? 'status-success' : 'status-error'}">
              ${action.message}
            </div>
            <div class="tab-access-time">${formatTime(action.timestamp)}</div>
          `;
          
          actionElement.appendChild(titleElement);
          actionElement.appendChild(detailsElement);
          redditActionsList.appendChild(actionElement);
        });
    });
  }

  // Function to render API requests
  function renderApiRequests() {
    chrome.storage.local.get(null, function(data) {
      apiRequestsList.innerHTML = '';
      
      // Filter for API request entries
      Object.entries(data)
        .filter(([key, value]) => value.isApiRequest)
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, 10) // Show only last 10 requests
        .forEach(([key, request]) => {
          const requestElement = document.createElement('div');
          requestElement.className = 'api-request-item';
          
          requestElement.innerHTML = `
            <div class="request-url">${request.url}</div>
            <div class="request-method">${request.method}</div>
            <div class="request-headers">
              <pre>${JSON.stringify(request.headers, null, 2)}</pre>
            </div>
            <div class="request-time">${formatTime(request.timestamp)}</div>
          `;
          
          apiRequestsList.appendChild(requestElement);
        });
    });
  }

  // Query for all tabs in all windows
  chrome.tabs.query({}, function(tabs) {
    // Get all access times first
    const tabIds = tabs.map(tab => `tab_${tab.id}_access`);
    const statusIds = tabs.map(tab => `tab_${tab.id}_pinecone_status`);
    const allIds = [...tabIds, ...statusIds];
    
    chrome.storage.local.get(allIds, function(data) {
      tabs.forEach(function(tab) {
        const tabElement = document.createElement('div');
        tabElement.className = 'tab-item';
        
        const titleElement = document.createElement('div');
        titleElement.className = 'tab-title';
        titleElement.textContent = tab.title;
        
        const urlElement = document.createElement('div');
        urlElement.className = 'tab-url';
        urlElement.textContent = tab.url;
        
        const accessTimeElement = document.createElement('div');
        accessTimeElement.className = 'tab-access-time';
        const accessTime = data[`tab_${tab.id}_access`];
        if (accessTime) {
          const timeString = new Date(accessTime).toLocaleString();
          accessTimeElement.textContent = `Last accessed: ${timeString}`;
        } else {
          accessTimeElement.textContent = 'No access time recorded';
        }
        
        const statusElement = document.createElement('div');
        statusElement.className = 'tab-status';
        const status = data[`tab_${tab.id}_pinecone_status`];
        if (status) {
          statusElement.textContent = `Pinecone status: ${status.success ? '✅' : '❌'} ${status.message}`;
          statusElement.classList.add(status.success ? 'status-success' : 'status-error');
        } else {
          statusElement.textContent = 'Not sent to Pinecone';
          statusElement.classList.add('status-pending');
        }
        
        tabElement.appendChild(titleElement);
        tabElement.appendChild(urlElement);
        tabElement.appendChild(accessTimeElement);
        tabElement.appendChild(statusElement);
        
        // Add click handler to focus the tab
        tabElement.addEventListener('click', function() {
          chrome.tabs.update(tab.id, { active: true });
          chrome.windows.update(tab.windowId, { focused: true });
        });
        
        tabsList.appendChild(tabElement);
      });
    });
  });

  // Initial render of Reddit actions
  renderRedditActions();

  // Initial render of API requests
  renderApiRequests();

  // Update storage change listener to include API requests
  chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local') {
      renderRedditActions();
      renderApiRequests();
    }
  });
});

// Add this code outside the DOMContentLoaded listener
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    // Create a unique key for this request
    const requestKey = `api_request_${Date.now()}`;
    
    // Store the request details
    const requestData = {
      isApiRequest: true,
      url: details.url,
      method: details.method,
      headers: details.requestHeaders.reduce((acc, header) => {
        acc[header.name] = header.value;
        return acc;
      }, {}),
      timestamp: Date.now()
    };

    // Store in chrome.storage.local
    chrome.storage.local.set({ [requestKey]: requestData });

    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
); 