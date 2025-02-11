// Store access times for tabs
chrome.tabs.onActivated.addListener(function(activeInfo) {
  const accessTime = new Date().getTime();
  chrome.storage.local.set({
    [`tab_${activeInfo.tabId}_access`]: accessTime
  });
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete') {
    const accessTime = new Date().getTime();
    chrome.storage.local.set({
      [`tab_${tabId}_access`]: accessTime
    });
  }
}); 