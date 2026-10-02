export default async function handler(req, res) {
  // Allow requests from Canvas
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { domain, courseId, studentId, startDate, finishDate } = req.body;
  const CANVAS_TOKEN = process.env.CANVAS_API_TOKEN;

  if (!CANVAS_TOKEN) {
    return res.status(500).json({ error: 'Server token missing. Add CANVAS_API_TOKEN in Vercel settings.' });
  }

  try {
    // 1. Fetch assignments
    const assignRes = await fetch(`https://${domain}/api/v1/courses/${courseId}/assignments?per_page=100`, {
      headers: { "Authorization": `Bearer ${CANVAS_TOKEN}` }
    });
    const assignments = await assignRes.json();

    if (!Array.isArray(assignments)) {
      return res.status(400).json({ error: 'Could not fetch assignments.' });
    }

    assignments.sort((a, b) => a.position - b.position);

    const start = new Date(startDate);
    const finish = new Date(finishDate);
    const totalTime = finish.getTime() - start.getTime();
    const interval = totalTime / Math.max(assignments.length - 1, 1);

    // 2. Loop through and create overrides for this specific student
    for (let i = 0; i < assignments.length; i++) {
      const targetDate = new Date(start.getTime() + (i * interval));
      targetDate.setHours(23, 59, 59);

      const payload = {
        assignment_override: {
          student_ids: [studentId],
          title: `Personal Schedule`,
          due_at: targetDate.toISOString()
        }
      };

      await fetch(`https://${domain}/api/v1/courses/${courseId}/assignments/${assignments[i].id}/overrides`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CANVAS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    }

    return res.status(200).json({ success: true, message: 'Calendar updated!' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
