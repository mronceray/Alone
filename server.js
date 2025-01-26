import OpenAI from 'openai';
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const characterContext = "tu es un personnage errant dans un espace blanc et vide. tu te demandes ce que tu fais là. tu met en place un  de hacker le système pour trouver une réponse. tu débordes de créativité.";

class ThoughtManager {
    constructor() {
        this.currentThought = null;
        this.thoughtHistory = [];  // Historique des pensées
        this.maxHistorySize = 5;   // Nombre max de pensées à garder
        this.initialMonologueGenerated = false;
    }

    async generateInitialMonologue() {
        const messages = [
            { role: "system", content: characterContext },
            { role: "user", content: "Génère un monologue initial basé sur le contexte donné." }
        ];
        
        try {
            const completion = await openai.chat.completions.create({
                messages: messages,
                model: "gpt-3.5-turbo",
                temperature: 0.9,
                max_tokens: 200,  // Permet un monologue plus long
            });

            const monologue = completion.choices[0].message.content.trim();
            this.thoughtHistory.push(monologue);
            this.currentThought = monologue;
            this.initialMonologueGenerated = true;
            return this.currentThought;
        } catch (error) {
            console.error('Error generating initial monologue:', error);
            return "Je me perds dans mes pensées...";
        }
    }

    async generateNextThought() {
        if (!this.initialMonologueGenerated) {
            return this.generateInitialMonologue();
        }

        const messages = [
            { role: "system", content: characterContext },
            { role: "assistant", content: this.currentThought },
            { role: "user", content: "Continue ton monologue basé sur ta dernière pensée." }
        ];

        try {
            const completion = await openai.chat.completions.create({
                messages: messages,
                model: "gpt-3.5-turbo",
                temperature: 0.9,
                max_tokens: 150,
            });

            const newThought = completion.choices[0].message.content.trim();
            
            // Vérifier si la pensée n'est pas un doublon
            if (this.thoughtHistory.includes(newThought)) {
                console.log('Pensée déjà utilisée, on en génère une autre...');
                return this.generateNextThought();
            }

            // Mettre à jour l'historique
            this.thoughtHistory.push(newThought);
            if (this.thoughtHistory.length > this.maxHistorySize) {
                this.thoughtHistory.shift(); // Enlever la plus ancienne
            }

            this.currentThought = newThought;
            return this.currentThought;
        } catch (error) {
            console.error('Error generating next thought:', error);
            return "Je me perds dans mes pensées...";
        }
    }
}

const thoughtManager = new ThoughtManager();

app.post('/think', async (req, res) => {
    try {
        const thought = await thoughtManager.generateNextThought();
        res.json({ thought });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate thought' });
    }
});

app.get('/test', (req, res) => {
    res.json({
        status: 'ok',
        initialized: thoughtManager.initialMonologueGenerated
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});