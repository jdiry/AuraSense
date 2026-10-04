import { expect, test } from "vitest";
import { formatGuardianAlert } from "../src/agent.js"

test("formats vital alerts correctly", () => {
    const alert = formatGuardianAlert("Heart Rate", 120, 100);
    expect(alert).toContain("AuraSense Alert: Heart Rate has reached 120");
    expect(alert).toContain("threshold of 100");
})