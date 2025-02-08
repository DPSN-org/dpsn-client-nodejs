"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const src_1 = __importDefault(require("../src"));
// Initialize DPSN client
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const dpsn = new src_1.default("DPSN_URL", "WALLET_PYT_KEY", {
                network: 'testnet',
                wallet_chain_type: 'ethereum',
                rpcUrl: "RPC_URL",
                isMainnet: false,
                isTestnet: true
            });
            dpsn.onConnect((res) => console.log(res));
            dpsn.onError((error) => {
                console.log("[Error LOG]", error);
            });
            console.log('Initializing DPSN client...');
            yield dpsn.init();
            const contractAddress = "CONTRACT_ADDRESS";
            dpsn.setContractAddress(contractAddress);
            // Get topic Hashes
            const topicHashes = yield dpsn.fetchOwnedTopics();
            console.log("Topics owned:", topicHashes);
            if (topicHashes.length === 0) {
                console.log("No topics owned. Please register a topic first.");
                return;
            }
            // Fetch price data from CoinGecko
            function fetchCoinGecko(targetToken, currency) {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        const baseUrl = "https://api.coingecko.com/api/v3/simple/price";
                        const params = new URLSearchParams({
                            ids: targetToken,
                            vs_currencies: currency
                        });
                        const url = `${baseUrl}?${params.toString()}`;
                        console.log('Fetching price from:', url);
                        const response = yield fetch(url, {
                            method: 'GET',
                            headers: {
                                'accept': 'application/json'
                            }
                        });
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const data = yield response.json();
                        return {
                            data_provider: 'coingecko',
                            id: targetToken,
                            price: data[targetToken][currency],
                            last_updated_at: Math.floor(Date.now() / 1000)
                        };
                    }
                    catch (error) {
                        console.error('Failed to fetch price:', error);
                        throw error;
                    }
                });
            }
            // Start publishing loop
            const ONE_MINUTE = 60 * 1000;
            console.log('Starting price publishing loop...');
            function publishPriceData(topicHash) {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        // Fetch latest price
                        const priceData = yield fetchCoinGecko('ethereum', 'usd');
                        console.log('Latest price data:', priceData);
                        // Publish to all owned topics
                        yield dpsn.publish(topicHash, priceData);
                    }
                    catch (error) {
                        console.error('Error in publish cycle:', error);
                    }
                });
            }
            // Initial publish
            // Set up interval for continuous publishing
            const fetchOwnedTopics = yield dpsn.fetchOwnedTopics();
            const topicHash = fetchOwnedTopics[2][1];
            console.log(`Publishing topic ${fetchOwnedTopics[2][0]} on ${fetchOwnedTopics[2][1]}`);
            // Initial publish
            yield publishPriceData(topicHash);
            // Then set up interval
            setInterval(() => {
                publishPriceData(topicHash).catch(error => {
                    console.error('Error in interval:', error);
                });
            }, ONE_MINUTE);
            console.log('Publisher running. Press Ctrl+C to stop.');
        }
        catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    });
}
// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nStopping publisher...');
    process.exit(0);
});
main();
