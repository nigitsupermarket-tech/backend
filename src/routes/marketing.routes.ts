import { Router } from 'express';
import {
  getCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  getAbandonedCarts, getEmailTemplates, getEmailTemplate, updateEmailTemplate,
} from '../controllers/marketing.controller';
import { protect, staffOrAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.use(protect, staffOrAdmin);

// Campaigns
router.get('/campaigns', getCampaigns);
router.get('/campaigns/:id', getCampaign);
router.post('/campaigns', createCampaign);
router.put('/campaigns/:id', updateCampaign);
router.delete('/campaigns/:id', deleteCampaign);

// Abandoned carts
router.get('/abandoned-carts', getAbandonedCarts);

// Email templates
router.get('/email-templates', getEmailTemplates);
router.get('/email-templates/:id', getEmailTemplate);
router.put('/email-templates/:id', updateEmailTemplate);

export default router;
