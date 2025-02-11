import { PINECONE_CONFIG } from './config/keys.js';

async function testPinecone() {
  try {
    // 1. Get index endpoint
    console.log('Getting index information...');
    const describeResponse = await fetch(
      'https://api.pinecone.io/indexes/prototype',
      {
        method: 'GET',
        headers: {
          'Api-Key': PINECONE_CONFIG.API_KEY
        }
      }
    );
    
    if (!describeResponse.ok) {
      throw new Error(`Failed to get index info: ${describeResponse.status}`);
    }
    
    const indexInfo = await describeResponse.json();
    console.log('Index info:', JSON.stringify(indexInfo, null, 2));
    const host = indexInfo.host;
    console.log('\nHost:', host);
    
    // 2. Upsert vectors
    console.log('\nUpserting vectors...');
    const upsertUrl = `https://${PINECONE_CONFIG.HOST}/vectors/upsert`;
    console.log('Upsert URL:', upsertUrl);
    const upsertResponse = await fetch(
      upsertUrl,
      {
        method: 'POST',
        headers: {
          'Api-Key': PINECONE_CONFIG.API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          vectors: [
            {
              id: 'test1',
              values: new Array(PINECONE_CONFIG.DIMENSION).fill(0.1),
              metadata: { type: 'test', category: 'A' }
            },
            {
              id: 'test2',
              values: new Array(PINECONE_CONFIG.DIMENSION).fill(0.2),
              metadata: { type: 'test', category: 'B' }
            }
          ],
        })
      }
    );

    if (!upsertResponse.ok) {
      const errorText = await upsertResponse.text();
      console.error('Upsert error response:', errorText);
      throw new Error(`Failed to upsert: ${upsertResponse.status}`);
    }

    const upsertResult = await upsertResponse.json();
    console.log('Upsert result:', upsertResult);

    // 3. Query vectors
    console.log('\nQuerying vectors...');
    const queryResponse = await fetch(
      `https://${PINECONE_CONFIG.HOST}/query`,
      {
        method: 'POST',
        headers: {
          'Api-Key': PINECONE_CONFIG.API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          namespace: 'test-namespace',
          vector: new Array(PINECONE_CONFIG.DIMENSION).fill(0.1),
          topK: 2,
          includeValues: true,
          includeMetadata: true,
          filter: { type: { $eq: 'test' } }
        })
      }
    );

    if (!queryResponse.ok) {
      throw new Error(`Failed to query: ${queryResponse.status}`);
    }

    const queryResult = await queryResponse.json();
    console.log('Query result:', queryResult);

  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Run the test
testPinecone(); 