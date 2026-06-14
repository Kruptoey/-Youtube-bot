import { Inngest } from "inngest";

// Create a client to send and receive events
export const inngest = new Inngest({ 
  id: "eazycal-youtube-bot",
  eventKey: process.env.INNGEST_EVENT_KEY || "local"
});
