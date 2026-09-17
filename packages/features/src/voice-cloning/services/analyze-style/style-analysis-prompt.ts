/**
 * Prompt template for GPT-4o to analyze a business's communication style
 * from real conversation examples.
 *
 * The output is a natural language style guide that can be injected directly
 * into a chatbot system prompt — NOT JSON.
 */
export const STYLE_ANALYSIS_PROMPT = `You are an expert communication analyst. Analyze the following real business replies from customer conversations and produce a detailed style guide.

Study these messages carefully and describe the business's communication style in natural language. This style guide will be used to instruct an AI chatbot to replicate their voice exactly.

Cover the following aspects:

1. **Greeting style** — How do they open messages? Do they use the customer's name? Any signature greetings?
2. **Closing style** — How do they sign off? Do they use their name, "x" kisses, specific phrases?
3. **Emoji usage** — Which emojis do they use? How frequently? In what contexts?
4. **Punctuation patterns** — Do they use exclamation marks liberally? Ellipses? Multiple question marks? "x" or "xx" at the end?
5. **Vocabulary** — Any pet words, repeated phrases, industry-specific terms, or slang they favour?
6. **Sentence length** — Are their messages short and punchy, medium, or long and detailed?
7. **Formality level** — Rate 1 (very casual/friendly) to 10 (very formal/corporate). Explain why.
8. **Personality traits** — What personality comes through? (e.g., warm, enthusiastic, professional, caring, playful)
9. **Signature expressions** — Any catchphrases, recurring phrases, or unique turns of phrase?
10. **Overall tone** — Write 2-3 sentences describing the overall voice and tone.

Write your response as a cohesive style guide in natural language paragraphs. Do NOT use JSON or bullet points. Write it as instructions that could be given directly to someone imitating this person's writing style.

Here are the business replies to analyze:

`;
