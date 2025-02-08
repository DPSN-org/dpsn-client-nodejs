import DpsnLib from '../src';
import { ethers } from 'ethers';

// Initialize DPSN client
async function main() {
  try {
    const dpsn = new DpsnLib("DPSN_URL","WALLET_PYT_KEY",{
      network:'testnet',
      blockchain:'ethereum',
      rpcUrl:"RPC_URL",
      isMainnet:false,
      isTestnet:true
    })

    dpsn.onConnect((res:any)=>console.log(res));

    dpsn.onError((error:any)=>{
      console.log("[Error LOG]",error);
    })
  
    console.log('Initializing DPSN client...');
    await dpsn.init();

    const contractAddress = "CONTRACT_ADDRESS";
  dpsn.setContractAddress(contractAddress);

    // Get topic Hashes
    const topicHashes = await dpsn.fetchOwnedTopics();

    console.log("Topics owned:", topicHashes);

    if (topicHashes.length === 0) {
      console.log("No topics owned. Please register a topic first.");
      return;
    }

    // Fetch price data from CoinGecko
    async function fetchCoinGecko(targetToken: string, currency: string) {
      try {
        const baseUrl = "https://api.coingecko.com/api/v3/simple/price";
        const params = new URLSearchParams({
          ids: targetToken,
          vs_currencies: currency
        });
        const url = `${baseUrl}?${params.toString()}`;
        console.log('Fetching price from:', url);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'accept': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return {
          data_provider: 'coingecko',
          id: targetToken,
          price: data[targetToken][currency],
          last_updated_at: Math.floor(Date.now() / 1000)
        };
      } catch (error) {
        console.error('Failed to fetch price:', error);
        throw error;
      }
    }

    // Start publishing loop
    const ONE_MINUTE = 60 * 1000;
    console.log('Starting price publishing loop...');
    
    async function publishPriceData(topicHash:string) {
      try {
        // Fetch latest price
        const priceData = await fetchCoinGecko('ethereum', 'usd');
        console.log('Latest price data:', priceData);

        // Publish to all owned topics


          await dpsn.publish(topicHash, priceData);

        
      } catch (error) {
        console.error('Error in publish cycle:', error);
      }
    }

    // Initial publish


    // Set up interval for continuous publishing
    const fetchOwnedTopics = await dpsn.fetchOwnedTopics();
    const topicHash = fetchOwnedTopics[2][1];

    console.log(`Publishing topic ${fetchOwnedTopics[2][0]} on ${fetchOwnedTopics[2][1]}`)
    
    // Initial publish
    await publishPriceData(topicHash);
    
    // Then set up interval
    setInterval(() => {
      publishPriceData(topicHash).catch(error => {
        console.error('Error in interval:', error);
      });
    }, ONE_MINUTE);
    console.log('Publisher running. Press Ctrl+C to stop.');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping publisher...');
  process.exit(0);
});

main();
