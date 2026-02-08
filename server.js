const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for SPA routing if needed (though we are using multi-page for better structure in vanilla)
app.get('*', (req, res) => {
    // If the file exists in public, it handles itself.
    // If not, send index.html or 404. 
    // For this simple MP app, we might check if it's an API call or page.
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).send('Not Found');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
