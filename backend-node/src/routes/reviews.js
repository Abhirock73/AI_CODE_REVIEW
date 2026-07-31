const express = require('express');
const authMiddleware = require('../middleware/auth');
const ReviewHistory = require('../models/ReviewHistory');
const PDFDocument = require('pdfkit');
const router = express.Router();

// GET /api/reviews/:id - Get a specific review by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const review = await ReviewHistory.findById(req.params.id);
    if (!review) return res.status(404).json({ message: 'Review not found' });
    
    // Check repository ownership
    const Repository = require('../models/Repository');
    const repo = await Repository.findOne({ _id: review.repositoryId, userId: req.userId });
    if (!repo) return res.status(403).json({ message: 'Not authorized to view this review' });

    res.json({ review, repo });
  } catch (error) {
    console.error('Fetch review error:', error);
    res.status(500).json({ message: 'Failed to fetch review details' });
  }
});

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

router.get('/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const review = await ReviewHistory.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, error: 'Review not found' });
    
    const Repository = require('../models/Repository');
    const repo = await Repository.findOne({ _id: review.repositoryId, userId: req.userId });
    if (!repo) return res.status(403).json({ success: false, error: 'Permission denied', details: 'Not authorized to view this review' });

    res.setHeader('Content-Type', 'application/pdf');
    const sanitizedFilename = `code-review-${(repo.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    doc.rect(0, 0, 595, 140).fill('#0f172a');
    doc.fill('#60a5fa').fontSize(28).font('Helvetica-Bold').text('AI Code Review Report', 50, 40);
    doc.fill('#94a3b8').fontSize(12).font('Helvetica').text(`Project: ${repo.name || 'Unknown'}`, 50, 80);
    doc.fill('#64748b').fontSize(10).text(`Generated: ${new Date().toUTCString()}`, 50, 100);
    doc.fill('#64748b').text(`Source: ${repo.url || 'N/A'}`, 50, 116);
    doc.moveDown(4);

    doc.fill('#1e293b').rect(50, 160, 495, 70).fill();
    const score = review?.reviewData?.score ?? repo?.qualityScore ?? 'N/A';
    const color = typeof score === 'number' ? scoreColor(score) : '#94a3b8';
    doc.fill(color).fontSize(36).font('Helvetica-Bold').text(`${score}`, 60, 172, { width: 60, align: 'center' });
    doc.fill('#94a3b8').fontSize(9).font('Helvetica').text('/ 100', 60, 210, { width: 60, align: 'center' });
    doc.fill('#e2e8f0').fontSize(13).font('Helvetica-Bold').text('Overall Quality Score', 135, 178);
    const summary = review?.reviewData?.summary || 'No AI summary available.';
    doc.fill('#94a3b8').fontSize(10).font('Helvetica').text(String(summary), 135, 196, { width: 360 });
    doc.moveDown(6);

    const langStats = repo?.metadata?.languageStats || {};
    if (Object.keys(langStats).length > 0) {
      doc.fill('#1e293b').fontSize(14).font('Helvetica-Bold').text('Language Distribution', 50, doc.y);
      drawRule(doc, doc.y + 4);
      doc.moveDown(0.8);
      let totalLines = 0;
      Object.values(langStats).forEach(s => { totalLines += s.lines || 0; });
      Object.entries(langStats).sort((a, b) => b[1].lines - a[1].lines).forEach(([lang, stats]) => {
        const p = totalLines > 0 ? ((stats.lines / totalLines) * 100).toFixed(1) : 0;
        doc.fill('#64748b').fontSize(10).font('Helvetica-Bold').text(`${lang}`, 60, doc.y, { continued: true });
        doc.fill('#94a3b8').font('Helvetica').text(`: ${stats.lines} lines (${p}%)`);
      });
      doc.moveDown(1.5);
    }

    const security = review?.reviewData?.securityIssues || [];
    if (security.length > 0) {
      doc.fill('#1e293b').fontSize(14).font('Helvetica-Bold').text(`Security Findings (${security.length})`, 50, doc.y);
      drawRule(doc, doc.y + 4);
      doc.moveDown(0.8);
      security.forEach((s, i) => {
        const severityStr = s?.severity ? `[${s.severity.toUpperCase()}] ` : '';
        const titleStr = s?.title || 'Unknown Issue';
        doc.fill('#ef4444').fontSize(10).font('Helvetica-Bold').text(`${i + 1}. ${severityStr}${titleStr}`, 60, doc.y);
        const fileStr = s?.file ? `File: ${s.file}${s?.line ? ` (Line ${s.line})` : ''}` : '';
        if (fileStr) doc.fill('#94a3b8').font('Helvetica').fontSize(9).text(fileStr, { indent: 10 });
        const descStr = s?.description || '';
        if (descStr) doc.fill('#cbd5e1').font('Helvetica').fontSize(10).text(`   ${descStr}`, { indent: 10 });
        doc.moveDown(0.5);
      });
    }
    doc.moveDown(1);

    const refactoring = review?.reviewData?.suggestions || [];
    if (refactoring.length > 0) {
      doc.fill('#1e293b').fontSize(14).font('Helvetica-Bold').text(`Refactoring & Suggestions (${refactoring.length})`, 50, doc.y);
      drawRule(doc, doc.y + 4);
      doc.moveDown(0.8);
      refactoring.forEach((r, i) => {
        const issueStr = r?.issue || 'Suggestion';
        doc.fill('#60a5fa').fontSize(10).font('Helvetica-Bold').text(`${i + 1}. ${issueStr}`, 60, doc.y);
        const suggStr = r?.suggestion || '';
        if (suggStr) doc.fill('#94a3b8').font('Helvetica').fontSize(9).text(`   → ${suggStr}`, { indent: 10 });
        doc.moveDown(0.5);
      });
    }
    doc.moveDown(1);

    const comments = review?.reviewData?.comments || [];
    if (comments.length > 0) {
      doc.fill('#1e293b').fontSize(14).font('Helvetica-Bold').text('General Comments', 50, doc.y);
      drawRule(doc, doc.y + 4);
      doc.moveDown(0.8);
      comments.forEach(c => {
        if (c) doc.fill('#94a3b8').fontSize(10).font('Helvetica').text(`• ${c}`, 60, doc.y);
        doc.moveDown(0.4);
      });
    }

    doc.fill('#334155').fontSize(8).text('Generated by AI Code Review Tool', 50, 800, { align: 'center', width: 495 });
    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'PDF generation failed', details: error.message });
    }
  }
});

module.exports = router;
