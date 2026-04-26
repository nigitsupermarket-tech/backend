import { Router } from "express";
import {
  getSettings,
  updateSettings,
  updateBranding,
  updateContactInfo,
  updateHeroSlides,
  updateHeroBanners,
  updateTrustBadges,
  updateAboutUs, // NEW
  updateContactPage, // NEW
  updatePrivacy,
  updateTerms,
} from "../controllers/settings.controller";
import {
  protect,
  adminOnly,
  optionalAuth,
} from "../middlewares/auth.middleware";

const router = Router();

router.get("/", optionalAuth, getSettings);
router.put("/", protect, adminOnly, updateSettings);
router.put("/branding", protect, adminOnly, updateBranding);
router.put("/contact", protect, adminOnly, updateContactInfo);
router.put("/hero-slides", protect, adminOnly, updateHeroSlides);
router.put("/hero-banners", protect, adminOnly, updateHeroBanners);
router.put("/trust-badges", protect, adminOnly, updateTrustBadges);

// NEW ROUTES
router.put("/about-us", protect, adminOnly, updateAboutUs);
router.put("/contact-page", protect, adminOnly, updateContactPage);

router.put("/privacy", protect, adminOnly, updatePrivacy);
router.put("/terms", protect, adminOnly, updateTerms);

export default router;
