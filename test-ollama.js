const { Ollama } = require('ollama');

async function test() {
    console.log('Podkluchayus k Ollama...');

    try {
        const ollama = new Ollama({ host: 'http://localhost:11434' });

        console.log('Otpravlyayu zapros...');
        const response = await ollama.chat({
            model: 'llama3.2:3b',
            messages: [{
                role: 'user',
                content: 'Privet! Otvet korotko na russkom.'
            }]
        });

        console.log('Otvet ot AI:');
        console.log(response.message.content);

    } catch (error) {
        console.error('Oshibka:', error.message);
        console.error('Ubedis chto Ollama zapushena (ikona v tree)');
    }
}

test();