import { Router } from "express";
import {
  listDrafts,
  getLastPageDraft,
  getDraft,
  upsertDraft,
  deleteDraft,
} from "../controllers/draft.controller";
import { protect } from "../middlewares/auth.middleware";

const router = Router();

router.use(protect);

// ⚠️  Static paths MUST come before /:key to avoid Express treating
//     "last-page" as a key value.
router.get("/", listDrafts);
router.get("/last-page", getLastPageDraft);
router.get("/:key", getDraft);
router.put("/:key", upsertDraft);
router.delete("/:key", deleteDraft);

export default router;
