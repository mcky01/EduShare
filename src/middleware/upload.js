const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsBase = path.join(__dirname, '..', '..', 'public', 'uploads');

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
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            const ext = path.extname(file.originalname);
            cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        }
    });
}

const imageFilter = (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowed.test(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only image files (JPG, PNG, GIF, WEBP) are allowed!'));
    }
};

const uploadAvatar = multer({
    storage: makeStorage('avatars'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

const uploadMaterial = multer({
    storage: makeStorage('materials'),
    limits: { fileSize: 50 * 1024 * 1024 }
});

const uploadSubmission = multer({
    storage: makeStorage('submissions'),
    limits: { fileSize: 50 * 1024 * 1024 }
});

const uploadLogo = multer({
    storage: makeStorage(''),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});

module.exports = {
    uploadAvatar,
    uploadMaterial,
    uploadSubmission,
    uploadLogo
};
