import fs from "fs";
import path from "path";

export const saveInvoicePdf = async (buffer: Buffer, fileName: string): Promise<string> => {
    try {
        // Make sure uploads/invoices folder exists
        const invoicesFolder = path.join(process.cwd(), "uploads", "invoices");
        if (!fs.existsSync(invoicesFolder)) {
            fs.mkdirSync(invoicesFolder, { recursive: true });
        }

        // Create unique file name
        const timestamp = Date.now();
        const filePath = path.join(invoicesFolder, `${fileName}-${timestamp}.pdf`);

        // Write buffer to file
        await fs.promises.writeFile(filePath, buffer);

        // Return relative path or URL to serve
        return `/uploads/invoices/${fileName}-${timestamp}.pdf`; 
        // If you want to serve via express static:
        // app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
    } catch (err: any) {
        console.error("Error saving PDF:", err);
        throw new Error(`Error saving PDF: ${err.message}`);
    }
};