// src/ai/index.ts

import { TerminalAgent } from './ai/agents/TerminalAgent/TerminalAgent';
import { FireworkClient } from './ai/models/clients/FireworkClient';
import { OpenAIClient } from './ai/models/clients/OpenAiClient';
import { AnthropicClient } from './ai/models/clients/AnthropicClient';
import { executeCommand } from './terminal/executeCommand';
import { ensureAuthenticated } from './twitter/twitterClient';
import { ModelType, Message } from './ai/types/agentSystem';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from './utils/logger';
import { createTerminalEntry, updateTerminalResponse, updateTerminalStatus } from './supabase/functions/terminal/terminalEntries';
import { 
  storeTerminalMessage, 
  getShortTermHistory, 
  clearShortTermHistory 
} from './supabase/functions/terminal/terminalHistory';
import { extractAndSaveLearnings } from './pipelines/extractLearnings';
import { getCurrentTimestamp } from './utils/formatTimestamps';

Logger.enable();

dotenv.config();

/**
 * Returns a random number between min and max (inclusive)
 */
function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Starts the AI system, which will run indefinitely with idle periods.
 */ 

// Helper function to get model client based on user selection, for initial testing.
function getModelClient(modelType: ModelType) {
  switch(modelType.toLowerCase()) {
    case 'openai':
      return new OpenAIClient('gpt-4o', { temperature: 1 });
    case 'firework':
      return new FireworkClient("accounts/fireworks/models/llama-v3p3-70b-instruct", { temperature: 1 });
    case 'anthropic':
      return new AnthropicClient("claude-3-5-haiku-20241022", { temperature: 1 });
    default:
      throw new Error('Invalid model type. Please choose "openai", "firework", or "anthropic"');
  }
}
export async function startAISystem() {
  try {
    const sessionId = uuidv4();
    await ensureAuthenticated();
    
    // Prompt user for model type if not provided via command line or env var
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Helper to get model type via CLI prompt
    const getModelTypeFromUser = (): Promise<ModelType> => {
      return new Promise((resolve, reject) => {
        readline.question('Which model would you like to use? (openai/firework/anthropic): ', (answer: string) => {
          const normalizedAnswer = answer.toLowerCase().trim() as ModelType;
          
          if (['openai', 'firework', 'anthropic'].includes(normalizedAnswer)) {
            readline.close();
            resolve(normalizedAnswer);
          } else {
            readline.close();
            reject(new Error('Invalid model type. Please choose "openai", "firework", or "anthropic"'));
          }
        });
      });
    };

    const modelType = await getModelTypeFromUser();
    console.log(`Using ${modelType} model client...`);
    const modelClient = getModelClient(modelType);

    // Set initial active status
    await updateTerminalStatus(true);
    Logger.log('Terminal status set to active');

    while (true) { // Run indefinitely with idle periods
      try {
        let actionCount = 0;
        const MAX_ACTIONS = 30; // Reduced for testing

        // Active period
        while (actionCount < MAX_ACTIONS) {
          // Start a new TerminalAgent instance
          const terminalAgent = new TerminalAgent(modelClient);

          // Load the latest short-term history into the new agent
          try {
            const shortTermHistory = await getShortTermHistory(6);
            if (shortTermHistory.length > 0) {
              Logger.log('Loading existing short-term history...');
              terminalAgent.loadChatHistory(shortTermHistory);
            }
          } catch (error) {
            Logger.log('Error loading short-term history:', error);
          }

          // Run the agent
          const functionResult = await terminalAgent.run();

          if (!functionResult.success) {
            throw new Error(functionResult.error);
          }

          // Create initial terminal entry
          const entryId = await createTerminalEntry(sessionId, {
            internal_thought: functionResult.output.internal_thought,
            plan: functionResult.output.plan,
            terminal_command: functionResult.output.terminal_command
          });

          if (!entryId) {
            throw new Error('Failed to create terminal entry');
          }

          // Execute command
          const commandOutput = await executeCommand(functionResult.output.terminal_command);

          // Update the same entry with the response
          await updateTerminalResponse(entryId, commandOutput.output);

          // Retrieve the last assistant message from the agent's message history
          const lastAssistantMessage = terminalAgent.getLastAgentMessage();

          if (lastAssistantMessage) {
            // Store agent's response in short-term history
            await storeTerminalMessage(lastAssistantMessage, sessionId);
          }

          // Store terminal output in short-term history and update agent's message history
          const terminalOutputMessage: Message = {
            role: 'user',
            content: `TERMINAL OUTPUT ${getCurrentTimestamp()}: ${commandOutput.output}`,
          };
          terminalAgent.addMessage(terminalOutputMessage);
          await storeTerminalMessage(terminalOutputMessage, sessionId);

          await new Promise((resolve) => setTimeout(resolve, 60000));
          actionCount++;
        }

        // Before entering idle mode, initiate the memory process, and wipe the short term history
        try {
          Logger.log('Initiating memory processing...');
          await extractAndSaveLearnings(sessionId);
          await clearShortTermHistory();
          Logger.log('Memory processing complete, short-term history cleared');
        } catch (error) {
          Logger.log('Error during memory processing:', error);
        }

        // Enter idle mode
        const idleMinutes = getRandomInt(30, 60);
        Logger.log(`Entering idle mode for ${idleMinutes} minutes`);
        await updateTerminalStatus(false);

        // Idle period
        await new Promise((resolve) => setTimeout(resolve, idleMinutes * 60 * 1000));

        // Resume active mode
        Logger.log('Resuming active mode');
        await updateTerminalStatus(true);

      } catch (error) {
        console.error('Error in AI system loop:', error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  } catch (error) {
    console.error('Error in AI system:', error);
  }
}

startAISystem();