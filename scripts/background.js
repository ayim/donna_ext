import { PINECONE_CONFIG } from '../config/keys.js';

// Function to send data to Pinecone
async function sendToPinecone(tabData) {
  console.log('Starting sendToPinecone with data:', tabData);
  const url = `https://${PINECONE_CONFIG.HOST}/vectors/upsert`;
  console.log('Sending to URL:', url);
  
  try {
    const requestBody = {
      vectors: [{
        id: `tab_${tabData.tabId}_${tabData.timestamp}`,
        values: generateMeaningfulVector(tabData.content),
        metadata: {
          tabId: tabData.tabId,
          url: tabData.url,
          title: tabData.title,
          timestamp: tabData.timestamp,
        }
      }]
    };
    console.log('Request body:', requestBody);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Api-Key': PINECONE_CONFIG.API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Response status:', response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response body:', errorText);
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Successfully sent to Pinecone:', data);
    console.log(`Data sent for tab ID: ${tabData.tabId}, Title: ${tabData.title}`);
    // Store success status
    await chrome.storage.local.set({
      [`tab_${tabData.tabId}_pinecone_status`]: {
        success: true,
        timestamp: new Date().getTime(),
        message: 'Successfully sent to Pinecone'
      }
    });
  } catch (error) {
    console.error('Error sending to Pinecone:', error.message);
    console.error('Full error:', error);
    // Store error status
    await chrome.storage.local.set({
      [`tab_${tabData.tabId}_pinecone_status`]: {
        success: false,
        timestamp: new Date().getTime(),
        message: error.message
      }
    });
  }
}

// Helper function to generate a meaningful vector based on content
function generateMeaningfulVector(content) {
  if (!content) return new Array(PINECONE_CONFIG.DIMENSION).fill(0.1); // Fallback for empty content

  // Combine all content fields into a single string
  const combinedText = [
    content.title || '',
    content.metaDescription || '',
    content.headings || '',
    content.mainContent || ''
  ].join(' ');

  // Simple TF-IDF style encoding
  const words = combinedText.toLowerCase().split(/\W+/);
  const vector = new Array(PINECONE_CONFIG.DIMENSION).fill(0);
  
  // Hash each word into the vector space
  words.forEach(word => {
    if (word.length > 0) {
      const hashCode = Array.from(word).reduce(
        (hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0
      );
      const index = Math.abs(hashCode) % PINECONE_CONFIG.DIMENSION;
      vector[index] += 1;
    }
  });
  
  // Normalize the vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => magnitude > 0 ? val / magnitude : 0.1); // Ensure no zeros
}

// Store access times and send to Pinecone when tab is activated
chrome.tabs.onActivated.addListener(async function(activeInfo) {
  const accessTime = new Date().getTime();
  
  // Get tab information
  const tab = await chrome.tabs.get(activeInfo.tabId);
  
  // Store locally
  chrome.storage.local.set({
    [`tab_${activeInfo.tabId}_access`]: accessTime
  });
  
  // Send to Pinecone
  await sendToPinecone({
    tabId: activeInfo.tabId,
    url: tab.url,
    title: tab.title,
    timestamp: accessTime,
  });
});

// Store access times and send to Pinecone when tab is updated
chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete') {
    const accessTime = new Date().getTime();
    
    // Get the tab's content
    let pageContent = '';
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: () => {
          // Extract meaningful text content
          const title = document.title;
          const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
          const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent).join(' ');
          const mainContent = document.body.innerText.slice(0, 1000); // First 1000 chars
          return { title, metaDescription, headings, mainContent };
        }
      });
      pageContent = result.result;
    } catch (error) {
      console.error('Error getting page content:', error);
    }
    
    // Store locally
    chrome.storage.local.set({
      [`tab_${tabId}_access`]: accessTime
    });
    
    // Send to Pinecone
    await sendToPinecone({
      tabId: tabId,
      url: tab.url,
      title: tab.title,
      timestamp: accessTime,
      content: pageContent
    });
  }
}); 