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
          isRedditPost: tabData.isRedditPost || false,
          subreddit: tabData.subreddit || '',
          postTitle: tabData.postTitle || '',
          postSummary: tabData.postSummary || '',
          redditAction: tabData.action || ''
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
        message: tabData.action ? 
          `Successfully saved to Pinecone (${tabData.action}ed Reddit post)` :
          'Successfully sent to Pinecone'
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
        message: tabData.action ? 
          `Failed to save to Pinecone (${tabData.action} Reddit post): ${error.message}` :
          error.message
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
    
    // Check if this is a Reddit post
    const isRedditPost = tab.url.match(/reddit\.com\/r\/\w+\/comments/);
    
    // Get the tab's content
    let pageContent = '';
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: () => {
          // Generic content extraction
          const basicContent = {
            title: document.title,
            metaDescription: document.querySelector('meta[name="description"]')?.content || '',
            headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent).join(' '),
            mainContent: document.body.innerText.slice(0, 1000)
          };
          
          // Reddit-specific content extraction
          const redditContent = {
            subreddit: document.querySelector('a[href^="/r/"]')?.textContent || '',
            postTitle: document.querySelector('h1')?.textContent || '',
            postContent: document.querySelector('[data-test-id="post-content"]')?.textContent || '',
            isRedditPost: true
          };
          
          return {
            ...basicContent,
            reddit: redditContent
          };
        }
      });
      pageContent = result.result;
    } catch (error) {
      console.error('Error getting page content:', error);
    }
    
    // Prepare metadata based on content type
    const metadata = {
      tabId: tabId,
      url: tab.url,
      title: tab.title,
      timestamp: accessTime,
    };

    // Add Reddit-specific metadata if it's a Reddit post
    if (isRedditPost && pageContent.reddit) {
      metadata.isRedditPost = true;
      metadata.subreddit = pageContent.reddit.subreddit;
      metadata.postTitle = pageContent.reddit.postTitle;
      metadata.postSummary = pageContent.reddit.postContent.slice(0, 500); // First 500 chars of post
    }
    
    // Send to Pinecone
    await sendToPinecone({
      ...metadata,
      content: pageContent
    });
  }
});

// Listen for messages from the content script
chrome.runtime.onMessage.addListener(
  async function(message) {
    if (message.type === 'REDDIT_ACTION') {
      try {
        console.log('Reddit action detected:', message);
        
        const tab = await chrome.tabs.get(message.tabId);
        console.log('Tab info:', {
          url: tab.url,
          title: tab.title
        });
        
        // Get post details and send to Pinecone
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          function: () => ({
            subreddit: document.querySelector('a[href^="/r/"]')?.textContent || '',
            postTitle: document.querySelector('h1')?.textContent || '',
            postContent: document.querySelector('[data-test-id="post-content"]')?.textContent || '',
          })
        });
        
        const actionVerb = {
          'upvote': 'Upvoted',
          'downvote': 'Downvoted',
          'save': 'Saved',
          'unvote': 'Removed vote from'
        }[message.action];
        
        console.log('Post details:', {
          subreddit: result.result.subreddit,
          title: result.result.postTitle,
          action: message.action,
          contentPreview: result.result.postContent.slice(0, 100) + '...'
        });
        
        await sendToPinecone({
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          timestamp: new Date().getTime(),
          isRedditPost: true,
          action: message.action,
          subreddit: result.result.subreddit,
          postTitle: result.result.postTitle,
          postSummary: result.result.postContent.slice(0, 500)
        });

        // Update status with Reddit-specific message
        const statusMessage = `${actionVerb} Reddit post in r/${result.result.subreddit}`;
        console.log('🔵 Reddit Action:', {
          action: message.action,
          subreddit: result.result.subreddit,
          title: result.result.postTitle,
          status: statusMessage,
          timestamp: new Date().toLocaleString()
        });

        await chrome.storage.local.set({
          [`tab_${tab.id}_pinecone_status`]: {
            success: true,
            timestamp: new Date().getTime(),
            message: statusMessage,
            isRedditAction: true,
            action: message.action
          }
        });
      } catch (error) {
        console.error('❌ Reddit Action Failed:', error);
        console.error('Error processing Reddit action:', error);
      }
    }
  }
); 