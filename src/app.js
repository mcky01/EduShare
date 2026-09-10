const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const sessionStore = require('./config/sessionStore');
const { brandingMiddleware } = require('./middleware/branding');
const { multerErrorHandler, notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

// Route modules
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const studentRoutes = require('./routes/studentRoutes');
const filesRoutes = require('./routes/filesRoutes');
const aiRoutes = require('./routes/aiRoutes');
const apiRoutes = require('./routes/apiRoutes');
const curriculumRoutes = require('./routes/curriculumRoutes');

const app = express();

// ==========================================
// Security & Parsers
// ==========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

const allowedOrigins = (process.env.FRONTEND_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true
}));

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

// Strict brute-force protection for credential endpoints (Phase 0 hardening).
// Counts per IP; generic 429 keeps login UX calm instead of leaking state.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    message: 'Too many sign-in attempts. Please wait 15 minutes and try again.'
});
app.use('/auth/login', loginLimiter);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// ==========================================
// Session Configuration
// ==========================================
app.use(session({
    store: sessionStore,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production'
    }
}));

// ==========================================
// View Engine (EJS + Express Layouts)
// ==========================================
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ==========================================
// Static Files
// ==========================================
app.use(express.static(path.join(__dirname, '..', 'public')));

// Development Request Logger
if (env.IS_DEV) {
    app.use((req, res, next) => {
        if (!req.path.startsWith('/css') && !req.path.startsWith('/js') && !req.path.startsWith('/images')) {
            console.log(`📡 ${req.method} ${req.url}`);
        }
        next();
    });
}

// Global Branding & Flash Context
app.use(brandingMiddleware);

// ==========================================
// Routes Mounting
// ==========================================
// Root redirect
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        const role = req.session.user.role;
        if (role === 'admin') return res.redirect('/admin/dashboard');
        if (role === 'teacher') return res.redirect('/teacher/dashboard');
        if (role === 'student') return res.redirect('/student/dashboard');
    }
    res.redirect('/auth/login');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', version: '2.0.0', time: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/teacher', teacherRoutes);
app.use('/student', studentRoutes);
app.use('/files', filesRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/curriculum', curriculumRoutes);
app.use('/api', apiRoutes);

// ==========================================
// Error Handlers
// ==========================================
app.use(multerErrorHandler);
app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = app;
