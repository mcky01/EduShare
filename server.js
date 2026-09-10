process.on('uncaughtException', (err) => {
    console.error('⚠️ [EduShare 2.0] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [EduShare 2.0] Unhandled Rejection:', reason);
});

const app = require('./src/app');
const env = require('./src/config/env');
const initDatabase = require('./src/config/initDatabase');

async function startServer() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                   EDUSHARE 2.0 LMS BOOTSTRAP                 ║');
    console.log('║        Zeferino Arroyo High School (Iriga City, 1981)         ║');
    console.log('║                 "Basta Zeferinian, Magaling Yan!"            ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');

    try {
        // Automatically verify and initialize database schema and seeds
        await initDatabase();

        const server = app.listen(env.PORT, () => {
            console.log('');
            console.log(`🚀 [EduShare 2.0] Server running at: http://localhost:${env.PORT}`);
            console.log(`📁 Environment: ${env.NODE_ENV}`);
            console.log(`🗄️  Database: MySQL (${env.DB_NAME}) at ${env.DB_HOST}:${env.DB_PORT}`);
            console.log(`🤖 AI Provider: Local Ollama (${env.OLLAMA_MODEL}) at ${env.OLLAMA_BASE_URL}`);
            console.log('');
            console.log('Demo accounts seeded via initDatabase (see README setup).');
            console.log('');
        });

        // Graceful shutdown
        const shutdown = () => {
            console.log('\n🛑 [EduShare 2.0] Shutting down gracefully...');
            server.close(() => {
                console.log('👋 [EduShare 2.0] Closed remaining connections.');
                process.exit(0);
            });
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (err) {
        console.error('❌ [EduShare 2.0] Fatal startup error:', err);
        process.exit(1);
    }
}

startServer();
