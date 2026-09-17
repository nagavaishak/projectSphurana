/**
 * Chatbot Tool Interface
 *
 * Tools are functions that the chatbot LLM can call during a conversation
 * to fetch external data or perform actions.
 */

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: string;
  error?: string;
}

export interface ToolContext {
  organizationId: string;
  conversationId?: string;
}

export interface ChatbotTool {
  /** Unique tool name (used in function calling) */
  name: string;
  /** Description for the LLM to understand when to call this tool */
  description: string;
  /** Parameter definitions */
  parameters: Record<string, ToolParameter>;
  /** Execute the tool with given params and context */
  execute: (
    params: Record<string, unknown>,
    context: ToolContext
  ) => Promise<ToolResult>;
}
