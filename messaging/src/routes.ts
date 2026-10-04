import { Router } from "express";
import { formatGuardianAlert } from "./agent.js";
import { activeSpace } from "./index.js";

const router = Router();

/**
 * POST /api/alert
 * Webhook triggered by the Python backend when vital anomalies (e.g. panic/anxiety spiked) occur.
 */
router.post("/alert", async (req, res) => {
    try {
        const { patientName, vital, value, threshold, notes } = req.body;

        if (!activeSpace) {
            return res.status(503).json({
                success: false,
                error: "No active guardian iMessage thread bound yet. Have the guardian text the line first."
            });
        }

        // Format guardian-focused notification
        const alertMessage = formatGuardianAlert({
            patientName: patientName || "Your family member",
            vital: vital || "Heart Rate",
            value,
            threshold,
            notes
        });

        // Send iMessage into the active guardian Space
        await activeSpace.send(alertMessage);

        return res.status(200).json({
            success: true,
            message: "Guardian escalation alert dispatched successfully."
        });
    } catch (error: any) {
        console.error("Error routing guardian alert:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

export default router;