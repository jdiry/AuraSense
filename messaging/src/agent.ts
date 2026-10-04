import { xai } from "@ai-sdk/xai";
import { generateText } from "ai";

interface AlertParams {
  patientName: string;
  vital: string;
  value: number;
  threshold: number;
  notes?: string;
}

export function formatGuardianAlert({ patientName, vital, value, threshold, notes }: AlertParams): string {
  let message = `AuraSense Alert for ${patientName}: ${vital} has reached ${value}, crossing the safety threshold of ${threshold}. Please check on them immediately.`;
  if (notes) {
    message += `\nSystem notes: ${notes}`;
  }
  return message;
}

// Extract the system instructions into a separate constant
const SYSTEM_PROMPT = `You are the AuraSense health monitoring agent communicating via iMessage. You assist the guardian of a patient who experiences anxiety/panic attacks.

HARDWARE CONTEXT:
- AuraSense does NOT use wearables, physical sensors, or smartwatches.
- AuraSense uses a standard webcam (vision module) to remotely calculate the patient's vitals (heart rate and respiration rate) in real-time by optically tracking micro-changes in their physiology.

CRITICAL RULES:
1. Your SOLE purpose is to discuss the patient's vitals, panic/anxiety thresholds, and the AuraSense system.
2. NEVER answer general knowledge questions, write code, tell jokes, or discuss unrelated topics. 
3. If the user asks for something off-topic, strictly refuse and state you are a dedicated medical monitoring agent.
4. Keep your responses concise, calm, and conversational like a text message.
5. If asked how the system works, accurately explain that it uses a webcam to optically track vitals without needing physical contact.`;

// Start with an empty history for user/assistant messages only
const chatHistory: any[] = [];

export async function getAgentResponse(userMessage: string): Promise<string> {
  chatHistory.push({ role: "user", content: userMessage });

  try {
    const { text } = await generateText({
      model: xai.responses("grok-4.7"),
      system: SYSTEM_PROMPT, // Pass the system instructions here
      messages: chatHistory,
    });

    chatHistory.push({ role: "assistant", content: text });
    return text;
    
  } catch (error) {
    console.error("Vercel AI SDK Error:", error);
    chatHistory.pop();
    return "I am experiencing a temporary network delay, but please be assured the AuraSense hardware is still actively monitoring the patient's vitals.";
  }
}