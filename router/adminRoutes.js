import express from "express";
import multer from "multer";
import { Readable } from "stream";
import cloudinary from "../config/cloudinary.js";
import Admin from "../models/admin.js";
import User from "../models/user.js";
import bcrypt from "bcrypt";

const router = express.Router();

//midd
const isAdminAuth = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  req.flash("error", "Please sign in to continue.");
  return res.redirect("/admin/login");
};

const isAlreadyLoggedIn = (req, res, next) => {
  if (req.session && req.session.isAdmin) return res.redirect("/admin/dashboard");
  return next();
};


   //get Ad login

router.get("/login", isAlreadyLoggedIn, (req, res) => {
  res.render("admin/login", {
    title: "Admin Sign In",
    error: req.flash("error"),
    success: req.flash("success"),
    formData: {}
  });
});

//post Ad login
router.post("/login", isAlreadyLoggedIn, async (req, res) => {
  const { email, password, remember } = req.body;

  try {
    if (!email || !password) {
      req.flash("error", "Email and password are required.");
      return res.render("admin/login", {
        title: "Admin Sign In",
        error: req.flash("error"),
        success: [],
        formData: { email }
      });
    }

    const admin = await Admin.findOne({ email: email.trim().toLowerCase() });
    if (!admin) {
      req.flash("error", "Invalid email or password.");
      return res.render("admin/login", {
        title: "Admin Sign In",
        error: req.flash("error"),
        success: [],
        formData: { email }
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      req.flash("error", "Invalid email or password.");
      return res.render("admin/login", {
        title: "Admin Sign In",
        error: req.flash("error"),
        success: [],
        formData: { email }
      });
    }

    req.session.isAdmin   = true;
    req.session.adminId   = admin._id;
    req.session.adminName = admin.name;

    if (remember) {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 7;
    }

    return res.redirect("/admin/dashboard");

  } catch (err) {
    console.error("Admin login error:", err);
    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/admin/login");
  }
});

//get Ad logout
router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error("Session destroy error:", err);
    res.clearCookie("connect.sid");
    res.redirect("/admin/login");
  });
});

//get Ad dash
router.get("/dashboard", isAdminAuth, async (req, res) => {
  try {
    const search   = (req.query.search || "").trim();
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = 8;                                      
    const skip     = (page - 1) * limit;

    // Build query search
    const query = { role: "user" };
    if (search) {
      query.$or = [
        { name:  { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }

    // pagenation count
    const total    = await User.countDocuments(query);
    const pages    = Math.ceil(total / limit);

    //D order
    const customers = await User.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.render("admin/dashboard", {
      title:     "Customers",
      adminName: req.session.adminName,
      customers,
      search,
      page,
      pages,
      total
    });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.render("admin/dashboard", {
      title:     "Customers",
      adminName: req.session.adminName,
      customers: [],
      search:    "",
      page:      1,
      pages:     1,
      total:     0
    });
  }
});

//blovk admin
router.post("/customers/:id/block", isAdminAuth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBlocked: true });
    req.flash("success", "User has been blocked.");
  } catch (err) {
    console.error("Block error:", err);
    req.flash("error", "Could not block user.");
  }

  const { search, page } = req.body;
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (page)   params.set("page", page);
  res.redirect("/admin/dashboard" + (params.toString() ? "?" + params.toString() : ""));
});

// unblock admin
router.post("/customers/:id/unblock", isAdminAuth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBlocked: false });
    req.flash("success", "User has been unblocked.");
  } catch (err) {
    console.error("Unblock error:", err);
    req.flash("error", "Could not unblock user.");
  }
  const { search, page } = req.body;
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (page)   params.set("page", page);
  res.redirect("/admin/dashboard" + (params.toString() ? "?" + params.toString() : ""));
});

//future
const storage = multer.memoryStorage();
const upload  = multer({ storage });

router.post("/upload", isAdminAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file provided." });

    const stream = cloudinary.uploader.upload_stream(
      { folder: "velmora" },
      (error, result) => {
        if (error) return res.status(500).json({ error });
        res.json({ url: result.secure_url });
      }
    );

    Readable.from(req.file.buffer).pipe(stream);

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed." });
  }
});

export default router;