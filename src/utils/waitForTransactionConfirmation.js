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
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForTransactionConfirmation = waitForTransactionConfirmation;
function showLoadingAnimation() {
    const frames = ["-", "\\", "|", "/"];
    let i = 0;
    return setInterval(() => {
        process.stdout.write(`\r${frames[i]} Waiting for transaction confirmation ${frames[i]}`);
        i = (i + 1) % frames.length;
    }, 200);
}
/**
 * Waits for a transaction to be confirmed on the blockchain of the rpc url .
 * @param provider - Ethers provider instance
 * @param txHash - Transaction hash to wait for
 * @param options - Configuration options
 * @returns Transaction receipt
 */
function waitForTransactionConfirmation(provider_1, txHash_1) {
    return __awaiter(this, arguments, void 0, function* (provider, txHash, options = {}) {
        const { confirmations = 1, timeout = 60000, // Default 60 seconds
        pollingInterval = 4000 // Default 4 seconds
         } = options;
        const startTime = Date.now();
        const loadingAnimation = showLoadingAnimation();
        try {
            while (true) {
                try {
                    // Check if we've exceeded the timeout
                    if (Date.now() - startTime > timeout) {
                        clearInterval(loadingAnimation);
                        process.stdout.write('\n'); // Clear the loading animation line
                        throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
                    }
                    // Get the transaction receipt
                    const receipt = yield provider.getTransactionReceipt(txHash);
                    if (receipt) {
                        // If we have a receipt but not enough confirmations, wait and check again
                        const currentConfirmations = yield receipt.confirmations();
                        if (currentConfirmations < confirmations) {
                            console.log(`Transaction confirmed in block ${receipt.blockNumber}. Waiting for ${confirmations - currentConfirmations} more confirmations...`);
                            yield new Promise(resolve => setTimeout(resolve, pollingInterval));
                            continue;
                        }
                        // We have enough confirmations
                        clearInterval(loadingAnimation);
                        process.stdout.write('\n'); // Clear the loading animation line
                        console.log(`Transaction fully confirmed with ${currentConfirmations} confirmations`);
                        return receipt;
                    }
                    // No receipt yet, transaction is still pending
                    console.log('Transaction pending...');
                    yield new Promise(resolve => setTimeout(resolve, pollingInterval));
                }
                catch (error) {
                    if (error.message.includes('timeout')) {
                        throw error;
                    }
                    // For other errors, log and continue polling
                    console.error('Error checking transaction status:', error);
                    yield new Promise(resolve => setTimeout(resolve, pollingInterval));
                }
            }
        }
        catch (error) {
            clearInterval(loadingAnimation);
            process.stdout.write('\n'); // Clear the loading animation line
            throw error;
        }
    });
}
