import { Router } from 'express';
import multer from 'multer';
import {
  getCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  getAbandonedCarts, getEmailTemplates, getEmailTemplate, updateEmailTemplate,
  getRecipientsCount, uploadRecipients, uploadPhoneRecipients,
  getEmailCampaigns, createEmailCampaign,
  getSmsCampaigns, createSmsCampaign, getSmsStatus,
} from '../controllers/marketing.controller';
import { protect, staffOrAdmin } from '../middlewares/auth.middleware';

// Recipient spreadsheets (CSV/XLS/XLSX) are small — memory storage + 5MB cap,
// same pattern as upload.routes.ts. Extension is checked in the controller
// via isAllowedSpreadsheetFile since mimetypes for CSV/XLSX are inconsistent
// across browsers/OSes.
const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const router = Router();

router.use(protect, staffOrAdmin);

// Campaigns (generic)
router.get('/campaigns', getCampaigns);
router.get('/campaigns/:id', getCampaign);
router.post('/campaigns', createCampaign);
router.put('/campaigns/:id', updateCampaign);
router.delete('/campaigns/:id', deleteCampaign);

// Recipients
router.get('/recipients/count', getRecipientsCount);
router.post('/recipients/upload', uploadSpreadsheet.single('file'), uploadRecipients);
router.post('/recipients/upload-phone', uploadSpreadsheet.single('file'), uploadPhoneRecipients);

// Email campaigns (bulk email — supports segment targeting and/or an
// uploaded spreadsheet of recipients via /recipients/upload)
router.get('/email-campaigns', getEmailCampaigns);
router.post('/email-campaigns', createEmailCampaign);

// SMS campaigns (bulk SMS via Termii — supports segment targeting and/or an
// uploaded spreadsheet of recipients via /recipients/upload-phone)
router.get('/sms-campaigns', getSmsCampaigns);
router.post('/sms-campaigns', createSmsCampaign);
router.get('/sms-provider-status', getSmsStatus);

// Abandoned carts
router.get('/abandoned-carts', getAbandonedCarts);

// Email templates
router.get('/email-templates', getEmailTemplates);
router.get('/email-templates/:id', getEmailTemplate);
router.put('/email-templates/:id', updateEmailTemplate);

export default router;
