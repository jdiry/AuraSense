import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import express from "express";
import alertRoutes from "./routes.js";
import { getAgentResponse } from "./agent.js";

// Store the active space to route backend alerts to the user
export let activeSpace: any = null;

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [
    // imessage
    imessage.config(),
  ],
  options: { logLevel: "info" }
});

const server = express();
server.use(express.json());

// Mount the routes from routes.ts
server.use("/api", alertRoutes);

server.listen(3001, () => console.log("Webhook listener on port 3001"));

// `app.messages` is an async iterable. Each tick yields a `space` (the
// conversation) and an inbound `message`. Reply by awaiting `space.send(...)`.
for await (const [space, message] of app.messages) {
  if (message.direction == "outbound") continue;

  // Bind the space for the backend webhook
  activeSpace = space;

  if (message.content.type === "text") {
    // Process inbound text messages with the LLM
    const userText = message.content.text;

    await space.responding(async () => {
      const aiReply = await getAgentResponse(userText);
      await message.reply(aiReply);
    });
  }
}
