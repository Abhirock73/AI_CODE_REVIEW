import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const generateReviewPDF = (repo, review) => {
  try {
    const doc = new jsPDF();
    const isGitHub = repo?.url?.includes('github.com');
    const repoType = isGitHub ? 'GitHub Repository' : 'Local ZIP Upload';
    const dateStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-').slice(0, 5);
    const fileName = `${repo.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Review_${dateStr}_${timeStr}.pdf`;

    // Colors
    const primaryColor = [37, 99, 235]; // Blue 600
    const textColor = [55, 65, 81]; // Gray 700
    const headingColor = [17, 24, 39]; // Gray 900
    const successColor = [34, 197, 94]; // Green 500
    const warningColor = [245, 158, 11]; // Yellow 500
    const dangerColor = [239, 68, 68]; // Red 500

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...primaryColor);
    doc.text('AI Code Review Report', 14, 22);

    // Metadata
    doc.setFontSize(10);
    doc.setTextColor(...textColor);
    doc.setFont('helvetica', 'normal');
    
    // Check if it's a fresh review or cached based on age
    const reviewAge = Date.now() - new Date(review.createdAt).getTime();
    const reviewSource = reviewAge < 60000 ? 'Fresh AI Review' : 'Cached Review';
    const generatedTime = new Date(review.createdAt).toLocaleString();

    let y = 35;
    const addMeta = (label, value) => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, 14, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(value), 50, y);
      y += 7;
    };

    addMeta('Repository', repo.name);
    addMeta('Type', repoType);
    addMeta('Generated', generatedTime);
    addMeta('Source', reviewSource);

    if (isGitHub) {
      addMeta('Owner', repo.url.split('/')[3] || 'Unknown');
      addMeta('Branch', 'main');
    }

    y += 5;

    // Stats Table
    const langStats = repo?.metadata?.languageStats || {};
    const totalFiles = Object.values(langStats).reduce((a, b) => a + b, 0) || 0;
    const score = review.reviewData?.score ?? review.qualityScore ?? 'N/A';
    
    autoTable(doc, {
      startY: y,
      head: [['Metric', 'Value']],
      body: [
        ['Overall Score', `${score}/100`],
        ['Total Files', String(totalFiles)],
        ['Repository Size', repo?.metadata?.size || 'Unknown'],
        ['Languages Detected', String(Object.keys(langStats).length)]
      ],
      theme: 'grid',
      headStyles: { fillColor: primaryColor },
      styles: { fontSize: 10, cellPadding: 5 },
      margin: { left: 14 }
    });

    y = doc.lastAutoTable.finalY + 15;

    // Summary Section
    const summary = review.reviewData?.summary;
    if (summary) {
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...headingColor);
      doc.text('Summary', 14, y);
      y += 8;
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...textColor);
      const splitSummary = doc.splitTextToSize(summary, 180);
      doc.text(splitSummary, 14, y);
      y += (splitSummary.length * 6) + 10;
    }

    // Helper for sections
    const addSection = (title, items, isSecurity = false) => {
      if (!items || items.length === 0) return;
      
      if (y > 250) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...headingColor);
      doc.text(title, 14, y);
      y += 8;

      doc.setFontSize(10);
      
      items.forEach((item, index) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }

        const isObj = typeof item === 'object' && item !== null;
        const text = isObj ? (item.title || item.issue || item.description || JSON.stringify(item)) : String(item);
        const suggestion = isObj ? item.suggestion : null;
        const file = isObj ? item.file : null;
        
        let color = textColor;
        if (isSecurity && isObj) {
          const sev = (item.severity || '').toLowerCase();
          if (sev === 'high') color = dangerColor;
          else if (sev === 'medium') color = warningColor;
          else if (sev === 'low') color = successColor;
        }

        doc.setTextColor(...color);
        doc.setFont('helvetica', 'bold');
        const prefix = `${index + 1}. `;
        doc.text(prefix, 14, y);
        
        doc.setFont('helvetica', 'normal');
        const splitText = doc.splitTextToSize(text, 170);
        doc.text(splitText, 14 + doc.getTextWidth(prefix), y);
        y += (splitText.length * 5);

        if (suggestion) {
          doc.setTextColor(100, 116, 139); // Slate 500
          doc.setFont('helvetica', 'italic');
          const splitSuggestion = doc.splitTextToSize(`Suggestion: ${suggestion}`, 170);
          doc.text(splitSuggestion, 20, y);
          y += (splitSuggestion.length * 5);
        }

        if (file) {
          doc.setTextColor(...primaryColor);
          doc.setFont('courier', 'normal');
          doc.text(`File: ${file}`, 20, y);
          y += 5;
        }
        
        y += 4; // spacing between items
      });
      y += 10;
    };

    // Parse specific sections
    const securityIssues = review.reviewData?.securityIssues || review.reviewData?.security || [];
    const suggestions = review.reviewData?.suggestions || review.reviewData?.refactoring || [];
    const comments = review.reviewData?.comments || [];

    addSection('Security Issues', securityIssues, true);
    addSection('Suggestions & Refactoring', suggestions);
    addSection('General Comments & Best Practices', comments);

    // Additional info from language stats
    if (Object.keys(langStats).length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...headingColor);
      doc.text('Detected Languages', 14, y);
      y += 8;

      const langBody = Object.entries(langStats)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => [lang, `${count} files`]);

      autoTable(doc, {
        startY: y,
        head: [['Language', 'Count']],
        body: langBody,
        theme: 'grid',
        headStyles: { fillColor: primaryColor },
        styles: { fontSize: 10, cellPadding: 5 },
        margin: { left: 14 }
      });
      y = doc.lastAutoTable.finalY + 15;
    }

    // Add Page Numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.setTextColor(156, 163, 175); // Gray 400
      doc.setFont('helvetica', 'normal');
      doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
    }

    doc.save(fileName);
    return true;
  } catch (error) {
    console.error("PDF Generation failed:", error);
    throw error;
  }
};
