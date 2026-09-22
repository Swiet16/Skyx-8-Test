import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface InvoiceTemplateProps {
  invoice: any;
  items: any[];
}

export const InvoiceTemplate = ({ invoice, items }: InvoiceTemplateProps) => {
  const generateBarcode = (data: string) => {
    // Simple barcode representation - in production, use a proper barcode library
    return `||||| | | |||| | ||| |||| | | |||||`;
  };

  const handlePrint = () => {
    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;

    const content = document.getElementById('invoice-content')?.innerHTML || '';
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice ${invoice.invoice_number}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .invoice-header { display: flex; justify-content: space-between; margin-bottom: 30px; }
            .company-info h1 { color: #2563eb; margin: 0; }
            .invoice-details { text-align: right; }
            .customer-info, .shipping-info { margin: 20px 0; }
            .items-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            .items-table th, .items-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            .items-table th { background-color: #f5f5f5; }
            .totals { text-align: right; margin-top: 20px; }
            .barcode { font-family: monospace; letter-spacing: 1px; margin: 20px 0; }
            @media print { button { display: none; } }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `);
    
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <Card className="max-w-4xl mx-auto">
      <CardContent className="p-8">
        <div id="invoice-content">
          {/* Header */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <img 
                  src="/images/skyxpress_logo.png" 
                  alt="SkyXpress Logo" 
                  className="w-12 h-12 object-contain"
                />
                <div>
                  <h1 className="text-3xl font-bold text-primary">SkyXpress</h1>
                  <p className="text-muted-foreground">Global Logistics Solutions</p>
                </div>
              </div>
              <div className="text-sm">
                <p>123 Express Lane, Logistics City</p>
                <p>LC 12345, United States</p>
                <p>Email: info@skyxpress.com</p>
                <p>Phone: +1 (555) 123-4567</p>
                <p>Website: www.myskyxpress.com</p>
              </div>
            </div>
            
            <div className="text-right">
              <h2 className="text-2xl font-bold mb-2">INVOICE</h2>
              <div className="text-sm space-y-1">
                <p><strong>Invoice #:</strong> {invoice.invoice_number}</p>
                <p><strong>Date:</strong> {format(new Date(invoice.invoice_date), 'MMM dd, yyyy')}</p>
                <p><strong>Due Date:</strong> {format(new Date(invoice.due_date), 'MMM dd, yyyy')}</p>
                <p><strong>Tracking #:</strong> {invoice.tracking_number}</p>
              </div>
            </div>
          </div>

          {/* Customer Info */}
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="font-semibold mb-2">Bill To:</h3>
              <div className="text-sm">
                <p className="font-medium">{invoice.customer_name}</p>
                <p>{invoice.customer_email}</p>
                {invoice.customer_phone && <p>{invoice.customer_phone}</p>}
                {invoice.customer_address && <p>{invoice.customer_address}</p>}
              </div>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2">Shipping Details:</h3>
              <div className="text-sm">
                <p><strong>From:</strong> {invoice.origin_country}</p>
                <p><strong>To:</strong> {invoice.destination_country}</p>
                <p><strong>Service:</strong> {invoice.service_type.toUpperCase()}</p>
                <p><strong>Weight:</strong> {invoice.weight} kg</p>
                {invoice.length && invoice.width && invoice.height && (
                  <p><strong>Dimensions:</strong> {invoice.length}×{invoice.width}×{invoice.height} cm</p>
                )}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full border-collapse border border-gray-300 mb-6">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-300 p-3 text-left">Description</th>
                <th className="border border-gray-300 p-3 text-right">Quantity</th>
                <th className="border border-gray-300 p-3 text-right">Unit Price</th>
                <th className="border border-gray-300 p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index}>
                  <td className="border border-gray-300 p-3">{item.description}</td>
                  <td className="border border-gray-300 p-3 text-right">{item.quantity}</td>
                  <td className="border border-gray-300 p-3 text-right">
                    {invoice.currency} {item.unit_price.toFixed(2)}
                  </td>
                  <td className="border border-gray-300 p-3 text-right">
                    {invoice.currency} {item.total_price.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{invoice.currency} {invoice.total_amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax (10%):</span>
                <span>{invoice.currency} {invoice.tax_amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t pt-2">
                <span>Total:</span>
                <span>{invoice.currency} {invoice.final_amount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Barcode */}
          <div className="mt-8 text-center">
            <div className="font-mono text-lg tracking-widest mb-2">
              {generateBarcode(invoice.barcode_data)}
            </div>
            <p className="text-sm text-muted-foreground">{invoice.barcode_data}</p>
          </div>

          {/* Payment Status */}
          <div className="mt-8 p-4 bg-gray-50 rounded">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-semibold">Payment Status: 
                  <span className={`ml-2 px-2 py-1 rounded text-xs ${
                    invoice.payment_status === 'paid' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {invoice.payment_status.toUpperCase()}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Track your shipment at: www.myskyxpress.com/track
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 text-xs text-center text-muted-foreground">
            <p>Thank you for choosing SkyXpress!</p>
            <p>For support, contact us at support@skyxpress.com or call +1 (555) 123-4567</p>
            <p className="mt-2">© 2025 SkyXpress Logistics. All rights reserved.</p>
          </div>
        </div>

        {/* Print Button */}
        <div className="mt-6 text-center">
          <Button onClick={handlePrint} className="no-print">
            Print Invoice
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};