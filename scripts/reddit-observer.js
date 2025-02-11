console.log('🚀 Reddit Observer Script Initialized');

// Create a PerformanceObserver to watch for Reddit event API calls
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name.includes('reddit.com/svc/shreddit/events')) {
      console.log('🎯 Reddit Event API Call Detected:', {
        url: entry.name,
        initiatorType: entry.initiatorType,
        duration: entry.duration,
        timestamp: new Date().toLocaleString()
      });
    }
  }
});

// Start observing network requests
observer.observe({ entryTypes: ['resource'] });

console.log('✅ Reddit Observer Setup Complete'); 