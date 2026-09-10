const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const uploadsBase = path.join(__dirname, '..', '..', 'storage', 'uploads');

const ALLOWED_DOC_EXTS = ['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'webp'];
const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

const DOC_MIME_MAP = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp'
};

function makeStorage(subDir) {
    const dir = path.join(uploadsBase, subDir);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
        }
    });
}

const imageFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const mimeOk = typeof file.mimetype === 'string' && file.mimetype.startsWith('image/');
    if (ALLOWED_IMAGE_EXTS.includes(ext) && mimeOk) {
        cb(null, true);
    } else {
        cb(new Error('Only image files (JPG, PNG, GIF, WEBP) are allowed!'));
    }
};

const documentFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const expected = DOC_MIME_MAP[ext];
    if (!expected) {
        return cb(new Error('File type not allowed.'));
    }
    const mime = file.mimetype || '';
    const mimeOk = ext === 'txt'
        ? mime === 'text/plain' || mime.startsWith('text/plain;')
        : mime === expected;
    if (!mimeOk) {
        return cb(new Error('File type not allowed.'));
    }
    cb(null, true);
};

const uploadAvatar = multer({
    storage: makeStorage('avatars'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

const uploadMaterial = multer({
    storage: makeStorage('materials'),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: documentFilter
});

const uploadSubmission = multer({
    storage: makeStorage('submissions'),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: documentFilter
});

const textOnlyFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const mime = file.mimetype || '';
    const txtOk = ext === 'txt' && (mime === 'text/plain' || mime.startsWith('text/plain;'));
    const pdfOk = ext === 'pdf' && mime === 'application/pdf';
    if (txtOk || pdfOk) {
        cb(null, true);
    } else {
        cb(new Error('Only .txt and text-based .pdf curriculum files are allowed for RAG ingestion.'));
    }
};

const uploadCurriculum = multer({
    storage: makeStorage('curriculum'),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: textOnlyFilter
});

const uploadLogo = multer({
    storage: makeStorage('logos'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

module.exports = {
    uploadAvatar,
    uploadMaterial,
    uploadSubmission,
    uploadCurriculum,
    uploadLogo,
    uploadsBase,
    ALLOWED_DOC_EXTS,
    ALLOWED_IMAGE_EXTS
};
