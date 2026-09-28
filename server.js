process.on('uncaughtException', (err) => {
    console.error('⚠️ [EduShare] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [EduShare] Unhandled Rejection:', reason);
});

const app = require('./src/app');
const env = require('./src/config/env');
const initDatabase = require('./src/config/initDatabase');

async function startServer() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                   EduShare LMS BOOTSTRAP                 ║');
    console.log('║        Zeferino Arroyo High School (Iriga City, 1981)         ║');
    console.log('║                 "Basta Zeferinian, Magaling Yan!"            ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');

    try {
        // Automatically verify and initialize database schema and seeds
        await initDatabase();

        const server = app.listen(env.PORT, () => {
            console.log('');
            console.log(`🚀 [EduShare] Server running at: http://localhost:${env.PORT}`);
            console.log(`📁 Environment: ${env.NODE_ENV}`);
            console.log(`🗄️  Database: MySQL (${env.DB_NAME}) at ${env.DB_HOST}:${env.DB_PORT}`);
            // Report the AI provider chain actually configured, not a hardcoded
            // assumption. 9Router needs base URL + key + model to be usable;
            // AI_PRIMARY decides which provider is tried first.
            const nineRouterReady = !!(env.NINE_ROUTER_BASE_URL && env.NINE_ROUTER_API_KEY && env.NINE_ROUTER_MODEL);
            const ollamaReady = !!(env.OLLAMA_BASE_URL && env.OLLAMA_MODEL);
            console.log(`🤖 AI Provider: primary=${env.AI_PRIMARY}, 9Router=${nineRouterReady ? `configured (${env.NINE_ROUTER_MODEL})` : 'not configured'}, Ollama=${ollamaReady ? `available (${env.OLLAMA_MODEL}) at ${env.OLLAMA_BASE_URL}` : 'not configured'}`);
            console.log(`   Fallback order: ${env.AI_PRIMARY === 'ollama' ? 'Ollama' : nineRouterReady ? '9Router' : 'Ollama'} → ${env.AI_PRIMARY === 'ollama' ? (nineRouterReady ? '9Router' : 'offline fallback') : 'Ollama'} → offline static fallback`);
            console.log(`   RAG embeddings: Ollama /api/embed (${env.OLLAMA_EMBED_MODEL})`);
            console.log('');
            console.log('Demo accounts seeded via initDatabase (see README setup).');
            console.log('');
        });

        // Graceful shutdown
        const shutdown = () => {
            console.log('\n🛑 [EduShare] Shutting down gracefully...');
            server.close(() => {
                console.log('👋 [EduShare] Closed remaining connections.');
                process.exit(0);
            });
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (err) {
        console.error('❌ [EduShare] Fatal startup error:', err);
        process.exit(1);
    }
}

startServer();
