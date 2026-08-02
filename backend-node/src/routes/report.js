const express = require('express');
const PDFDocument = require('pdfkit');
const authMiddleware = require('../middleware/auth');
const workspaceAuth = require('../middleware/workspaceAuth');
const Repository = require('../models/Repository');
const ReviewHistory = require('../models/ReviewHistory');

const WorkspaceManager = require('../services/WorkspaceManager');

const router = express.Router();

// Helper: draw a horizontal rule
function drawRule(doc, y) {
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#334155').lineWidth(1).stroke();
}

// Helper: score color
function scoreColor(score) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

router.get('/:id/export/pdf', authMiddleware, workspaceAuth, async (req, res) => {
  try {
    const repo = await Repository.findOne({ _id: req.params.id, userId: req.userId });
    if (!repo) return res.status(404).json({ message: 'Repository not found' });

    await WorkspaceManager.getWorkspace(req.params.id, req.userId);

    const latestReview = await ReviewHistory.findOne({ repositoryId: repo._id }).sort({ createdAt: -1 });

    // Set up response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="code-review-${repo.name}.pdf"`);

    // Create PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // ── COVER PAGE ──────────────────────────────────────────────
    doc.rect(0, 0, 595, 140).fill('#0f172a');
    doc.fill('#60a5fa').fontSize(28).font('Helvetica-Bold').text('AI Code Review Report', 50, 40);
    doc.fill('#94a3b8').fontSize(12).font('Helvetica').text(`Project: ${repo.name}`, 50, 80);
    doc.fill('#64748b').fontSize(10).text(`Generated: ${new Date().toUTCString()}`, 50, 100);
    doc.fill('#64748b').text(`Source: ${repo.url}`, 50, 116);

    doc.moveDown(4);

    // ── QUALITY SCORE SECTION ─────────────────────────────────
    doc.fill('#1e293b').rect(50, 160, 495, 70).fill();
    const score = latestReview?.reviewData?.score ?? repo.qualityScore ?? 'N/A';
    const color = typeof score === 'number' ? scoreColor(score) : '#94a3b8';
    doc.fill(color).fontSize(36).font('Helvetica-Bold').text(`${score}`, 60, 172, { width: 60, align: 'center' });
    doc.fill('#94a3b8').fontSize(9).font('Helvetica').text('/ 100', 60, 210, { width: 60, align: 'center' });
    doc.fill('#e2e8f0').fontSize(13).font('Helvetica-Bold').text('Overall Quality Score', 135, 178);
    doc.fill('#94a3b8').fontSize(10).font('Helvetica').text(latestReview?.reviewData?.summary || 'No AI summary available.', 135, 196, { width: 360 });

    doc.moveDown(6);

    // ── LANGUAGE DISTRIBUTION ─────────────────────────────────
    const langStats = repo.metadata?.languageStats || {};
    if (Object.keys(langStats).length > 0) {
      doc.fill('#1e293b').fontSize(14).font('Helvetica-Bold').text('Language Distribution', 50, doc.y);
      drawRule(doc, doc.y + 4);
      doc.moveDown(0.8);

      Object.entries(langStats).forEach(([lang, count]) => {
        const y = doc.y;
        doc.fill('#94a3b8').fontSize(10).font('Helvetica').text(lang, 60, y, { width: 200 });
        doc.fill('#60a5fa').text(`${count} files`, 260, y, { width: 100 });
        doc.moveDown(0.4);
      });
      doc.moveDown(1);
    }

    // ── SECURITY FINDINGS ─────────────────────────────────────
    const security = latestReview?.reviewData?.security || [];
    doc.fill('#1e293b').fontSize(14).font('Helvetica-Bold').text('Security Findings', 50, doc.y);
    drawRule(doc, doc.y + 4);
    doc.moveDown(0.8);

    if (security.length === 0) {
      doc.fill('#22c55e').fontSize(10).font('Helvetica').text('✓ No security issues detected.', 60, doc.y);
    } else {
      security.forEach((s, i) => {
        const severityColor = s.severity === 'high' ? '#ef4444' : s.severity === 'medium' ? '#f59e0b' : '#94a3b8';
        doc.fill(severityColor).fontSize(10).font('Helvetica-Bold').text(`[${(s.severity || 'info').toUpperCase()}]`, 60, doc.y, { continued: true });
        doc.fill('#e2e8f0').font('Helvetica').text(` ${s.description}`);
        if (s.suggestion) doc.fill('#64748b').fontSize(9).text(`  → ${s.suggestion}`, { indent: 15 });
        doc.moveDown(0.5);
      });
    }
    doc.moveDown(1);

    // ── REFACTORING SUGGESTIONS ────────────────────────────────
    const refactoring = latestReview?.reviewData?.refactoring || [];
    doc.fill('#1e293b').fontSize(14).font('Helvetica-Bold').text('Refactoring Suggestions', 50, doc.y);
    drawRule(doc, doc.y + 4);
    doc.moveDown(0.8);

    if (refactoring.length === 0) {
      doc.fill('#94a3b8').fontSize(10).font('Helvetica').text('No refactoring suggestions available.', 60, doc.y);
    } else {
      refactoring.forEach((r, i) => {
        doc.fill('#60a5fa').fontSize(10).font('Helvetica-Bold').text(`${i + 1}. ${r.issue}`, 60, doc.y);
        doc.fill('#94a3b8').font('Helvetica').fontSize(9).text(`   → ${r.suggestion}`, { indent: 10 });
        doc.moveDown(0.5);
      });
    }
    doc.moveDown(1);

    // ── GENERAL COMMENTS ──────────────────────────────────────
    const comments = latestReview?.reviewData?.comments || [];
    if (comments.length > 0) {
      doc.fill('#1e293b').fontSize(14).font('Helvetica-Bold').text('General Comments', 50, doc.y);
      drawRule(doc, doc.y + 4);
      doc.moveDown(0.8);
      comments.forEach(c => {
        doc.fill('#94a3b8').fontSize(10).font('Helvetica').text(`• ${c}`, 60, doc.y);
        doc.moveDown(0.4);
      });
    }

    // ── FOOTER ────────────────────────────────────────────────
    doc.fill('#334155').fontSize(8).text('Generated by AI Code Review Tool', 50, 800, { align: 'center', width: 495 });

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to generate PDF report' });
    }
  }
});

module.exports = router;
