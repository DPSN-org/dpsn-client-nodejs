import { ethers } from 'ethers';

function showLoadingAnimation() {
    const frames = ["-", "\\", "|", "/"];
    let i = 0;
    return setInterval(() => {
        process.stdout.write(`\r${frames[i]} Waiting for transaction confirmation ${frames[i]}`);
        i = (i + 1) % frames.length;
    }, 200);
}

interface WaitForTransactionOptions {
    confirmations?: number;      // Number of confirmations to wait for
    timeout?: number;           // Timeout in milliseconds
    pollingInterval?: number;   // How often to check for confirmations (in ms)
}

/**
 * Waits for a transaction to be confirmed on the blockchain
 * @param provider - Ethers provider instance
 * @param txHash - Transaction hash to wait for
 * @param options - Configuration options
 * @returns Transaction receipt
 */
export async function waitForTransactionConfirmation(
    provider: ethers.Provider,
    txHash: string,
    options: WaitForTransactionOptions = {}
): Promise<ethers.TransactionReceipt> {
    const {
        confirmations = 1,
        timeout = 60000,        // Default 60 seconds
        pollingInterval = 4000  // Default 4 seconds
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
                const receipt = await provider.getTransactionReceipt(txHash);

                if (receipt) {
                    // If we have a receipt but not enough confirmations, wait and check again
                    const currentConfirmations = await receipt.confirmations();
                    if (currentConfirmations < confirmations) {
                        console.log(`Transaction confirmed in block ${receipt.blockNumber}. Waiting for ${confirmations - currentConfirmations} more confirmations...`);
                        await new Promise(resolve => setTimeout(resolve, pollingInterval));
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
                await new Promise(resolve => setTimeout(resolve, pollingInterval));

            } catch (error) {
                if ((error as Error).message.includes('timeout')) {
                    throw error;
                }
                // For other errors, log and continue polling
                console.error('Error checking transaction status:', error);
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }
        }
    } catch (error) {
        clearInterval(loadingAnimation);
        process.stdout.write('\n'); // Clear the loading animation line
        throw error;
    }
}
