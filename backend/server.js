// server.js - Backend for OTP Generation and Email/SMS
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (use Redis/Database in production)
const otpStore = new Map();

// Email transporter configuration (use your email service)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
});

/**
 * Generate OTP and its hash
 */
function generateOTP() {
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    return { otp, otpHash };
}

/**
 * POST /api/generate-otp
 * Generate OTP for order delivery
 */
app.post('/api/generate-otp', async (req, res) => {
    try {
        const { orderId, sellerAddress, buyerEmail } = req.body;
        
        if (!orderId || !sellerAddress || !buyerEmail) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Generate OTP
        const { otp, otpHash } = generateOTP();
        
        // Store OTP with expiration (5 minutes)
        otpStore.set(orderId, {
            otp,
            otpHash,
            sellerAddress,
            buyerEmail,
            createdAt: Date.now(),
            expiresAt: Date.now() + 5 * 60 * 1000
        });
        
        // Send OTP to buyer via email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: buyerEmail,
            subject: `Delivery OTP for Order #${orderId}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>Delivery Confirmation</h2>
                    <p>Your order <strong>#${orderId}</strong> has been shipped!</p>
                    <p>Your One-Time Password (OTP) for delivery confirmation is:</p>
                    <div style="background: #f0f0f0; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 5px; font-weight: bold;">
                        ${otp}
                    </div>
                    <p style="color: #666; font-size: 14px;">This OTP will expire in 5 minutes.</p>
                    <p>Please provide this OTP to the delivery person or enter it in the app to confirm delivery.</p>
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
                    <p style="color: #999; font-size: 12px;">This is an automated message from Decentralized Escrow Platform.</p>
                </div>
            `
        };
        
        await transporter.sendMail(mailOptions);
        
        console.log(`OTP generated for order ${orderId}: ${otp}`);
        
        res.json({
            success: true,
            otpHash,
            message: 'OTP sent to buyer email',
            // In development, return OTP (REMOVE IN PRODUCTION)
            devOTP: process.env.NODE_ENV === 'development' ? otp : undefined
        });
        
    } catch (error) {
        console.error('Error generating OTP:', error);
        res.status(500).json({ error: 'Failed to generate OTP' });
    }
});

/**
 * POST /api/verify-otp
 * Verify OTP before blockchain confirmation
 */
app.post('/api/verify-otp', (req, res) => {
    try {
        const { orderId, otp } = req.body;
        
        if (!orderId || !otp) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const storedData = otpStore.get(orderId);
        
        if (!storedData) {
            return res.status(404).json({ error: 'OTP not found or expired' });
        }
        
        // Check expiration
        if (Date.now() > storedData.expiresAt) {
            otpStore.delete(orderId);
            return res.status(400).json({ error: 'OTP expired' });
        }
        
        // Verify OTP
        if (storedData.otp === otp) {
            // Don't delete yet - allow blockchain confirmation
            res.json({
                success: true,
                message: 'OTP verified successfully',
                otpHash: storedData.otpHash
            });
        } else {
            res.status(400).json({ error: 'Invalid OTP' });
        }
        
    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
});

/**
 * GET /api/otp-status/:orderId
 * Check if OTP exists and is valid
 */
app.get('/api/otp-status/:orderId', (req, res) => {
    const { orderId } = req.params;
    const storedData = otpStore.get(orderId);
    
    if (!storedData) {
        return res.json({ exists: false });
    }
    
    const isValid = Date.now() < storedData.expiresAt;
    
    res.json({
        exists: true,
        isValid,
        expiresAt: storedData.expiresAt
    });
});

/**
 * DELETE /api/clear-otp/:orderId
 * Clear OTP after successful blockchain confirmation
 */
app.delete('/api/clear-otp/:orderId', (req, res) => {
    const { orderId } = req.params;
    otpStore.delete(orderId);
    res.json({ success: true, message: 'OTP cleared' });
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        activeOTPs: otpStore.size
    });
});

// Cleanup expired OTPs every minute
setInterval(() => {
    const now = Date.now();
    for (const [orderId, data] of otpStore.entries()) {
        if (now > data.expiresAt) {
            otpStore.delete(orderId);
            console.log(`Cleaned up expired OTP for order ${orderId}`);
        }
    }
}, 60000);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
