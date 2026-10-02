export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let { domain, courseId, studentId, startDate, finishDate, moduleWeights } = req.body;
  const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;

  if (!domain || !courseId || !startDate || !finishDate) {
    return res.status(400).json({ error: 'Missing required parameters.' });
  }

  try {
    // Auto-resolve Student ID via Canvas API if missing or raw string
    if (!studentId || studentId === '$Canvas.user.id' || isNaN(studentId)) {
      const selfRes = await fetch(`https://${domain}/api/v1/users/self`, {
        headers: { 'Authorization': `Bearer ${CANVAS_API_TOKEN}` }
      });

      if (selfRes.ok) {
        const selfData = await selfRes.json();
        studentId = selfData.id;
      } else {
        // Fallback: Fetch student enrollments for the course
        const enrollRes = await fetch(`https://${domain}/api/v1/courses/${courseId}/enrollments?type[]=StudentEnrollment`, {
          headers: { 'Authorization': `Bearer ${CANVAS_API_TOKEN}` }
        });
        const enrollments = await enrollRes.json();
        
        if (enrollments && enrollments.length > 0) {
          studentId = enrollments[0].user_id;
        } else {
          throw new Error("Could not automatically determine Student ID from Canvas.");
        }
      }
    }

    // Fetch assignments for pacing
    const assignmentsRes = await fetch(`https://${domain}/api/v1/courses/${courseId}/assignments?per_page=100`, {
      headers: { 'Authorization': `Bearer ${CANVAS_API_TOKEN}` }
    });

    if (!assignmentsRes.ok) {
      throw new Error(`Canvas API returned status ${assignmentsRes.status}`);
    }

    let assignments = await assignmentsRes.json();
    assignments.sort((a, b) => (a.position || 0) - (b.position || 0));

    if (assignments.length === 0) {
      return res.status(200).json({ success: true, message: 'No assignments found to pace.' });
    }

    // Pacing Calculation
    let totalWeight = 0;
    const weightedAssignments = assignments.map((assignment, idx) => {
      let weight = 1.0;
      const modIndex = idx + 1;
      if (moduleWeights && moduleWeights[modIndex]) {
        weight = parseFloat(moduleWeights[modIndex]);
      }
      totalWeight += weight;
      return { ...assignment, weight };
    });

    const startMs = new Date(startDate).getTime();
    const finishMs = new Date(finishDate).getTime();
    const totalDurationMs = finishMs - startMs;

    if (totalDurationMs <= 0) {
      return res.status(400).json({ error: 'Finish date must be after start date.' });
    }

    let cumulativeWeight = 0;
    for (const assignment of weightedAssignments) {
      cumulativeWeight += assignment.weight;
      const progressRatio = cumulativeWeight / totalWeight;
      const targetTimeMs = startMs + (totalDurationMs * progressRatio);

      const targetDueDate = new Date(targetTimeMs);
      targetDueDate.setHours(23, 59, 59, 999);

      // Create/Update Assignment Override
      await fetch(`https://${domain}/api/v1/courses/${courseId}/assignments/${assignment.id}/overrides`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          assignment_override: {
            student_ids: [studentId],
            due_at: targetDueDate.toISOString(),
            title: `Paced Override for Student ${studentId}`
          }
        })
      });
    }

    return res.status(200).json({ success: true, message: 'Weighted schedule successfully updated!' });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Internal server error.' });
  }
}
