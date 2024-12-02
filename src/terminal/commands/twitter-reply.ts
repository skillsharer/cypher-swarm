import { Command } from '../types/commands';
import { replyToTweet } from '../../twitter/functions/replyToTweet';
import { generateTweetReply } from '../../tests/replyTest';
import { assembleTwitterInterface } from '../../twitter/utils/imageUtils';

/**
 * @command twitter-reply
 * @description Replies to a specified tweet
 */
export const twitterReply: Command = {
  name: 'reply-to-tweet',
  description: 'Replies to a specified tweet with optional media attachments',
  parameters: [
    {
      name: 'tweetId',
      description: 'ID of the tweet to reply to',
      required: true,
      type: 'string'
    }
  ],
  handler: async (args) => {
    try {
      const mediaUrls = args.mediaUrls ? args.mediaUrls.split(',').map(url => url.trim()) : undefined;
      
      // Assemble Twitter interface once
      const { textContent, imageContents } = await assembleTwitterInterface(".", args.tweetId);
      
      // Generate reply using the preassembled interface
      const reply = await generateTweetReply(args.tweetId, "What would you reply to this tweet?", textContent, imageContents);
      
      // Pass textContent to replyToTweet
      const result = await replyToTweet(args.tweetId, reply, mediaUrls, textContent);
      
      return {
        output: `${result.success ? '✅' : '❌'} Action: Reply Tweet\n` +
               `Parent Tweet ID: ${args.tweetId}\n` +
               `${result.tweetId ? `Reply Tweet ID: ${result.tweetId}\n` : ''}` +
               `Status: ${result.success ? 'Success' : 'Failed'}\n` +
               `Text: ${args.text}\n` +
               `Media: ${mediaUrls ? mediaUrls.join(', ') : 'None'}\n` +
               `Details: ${result.message}`
      };
    } catch (error) {
      return {
        output: `❌ Action: Reply Tweet\n` +
               `Parent Tweet ID: ${args.tweetId}\n` +
               `Status: Error\n` +
               `Details: ${error.message}`
      };
    }
  }
}; 