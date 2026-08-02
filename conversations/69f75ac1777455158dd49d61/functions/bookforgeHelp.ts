// BookForge Help Bot — receives questions from the BookForge AI app
// Creates a HelpRequest entity that triggers a workflow to notify Axel
// Also can check for responses

export default async function bookforgeHelp(req, res) {
  try {
    const { action, question, context, requestId } = req.body || {};
    
    if (action === "ask") {
      // Create a new help request
      const record = await base44.entities.HelpRequest.create({
        question: question || "",
        context: context || "",
        answered: false,
        answer: ""
      });
      
      res.json({
        ok: true,
        requestId: record.id,
        message: "Your question has been sent to Axel! He'll respond shortly."
      });
    } else if (action === "check") {
      // Check if Axel has responded
      const records = await base44.entities.HelpRequest.read({
        filter: { id: requestId },
        limit: 1
      });
      
      if (records && records.length > 0) {
        const r = records[0];
        res.json({
          ok: true,
          answered: r.data.answered || false,
          answer: r.data.answer || "",
          question: r.data.question || ""
        });
      } else {
        res.json({ ok: false, error: "Request not found" });
      }
    } else if (action === "recent") {
      // Get recent help requests for this user
      const records = await base44.entities.HelpRequest.read({
        limit: 10,
        sort: "-created_date"
      });
      
      res.json({
        ok: true,
        requests: (records || []).map(r => ({
          id: r.id,
          question: r.data.question || "",
          answer: r.data.answer || "",
          answered: r.data.answered || false,
          created_date: r.created_date
        }))
      });
    } else {
      res.json({ ok: false, error: "Unknown action" });
    }
  } catch (err) {
    console.error("bookforgeHelp error:", err);
    res.json({ ok: false, error: err.message || "Something went wrong" });
  }
}
