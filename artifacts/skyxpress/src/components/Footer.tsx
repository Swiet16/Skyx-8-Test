import { Link } from "react-router-dom";
import { Plane, Facebook, Twitter, Linkedin, Instagram } from "lucide-react";
import skyxpressLogo from "@/assets/skyxpress-logo.jpg";

const Footer = () => {
  return (
    <footer className="bg-black text-white border-t border-border">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Company Info */}
          <div className="space-y-4">
            <div className="flex items-center space-x-3 mb-4">
              <img 
                 src="https://thunaolandjuvuhvbsds.supabase.co/storage/v1/object/public/File/skyxpress_logo.png"
                alt="SkyXpress Logo" 
                className="h-12 w-auto object-contain"
              />
              <div>
                <span className="text-xl font-bold">
                  <span className="text-secondary">Sky</span>
                  <span className="text-primary">Xpress</span>
                </span>
                <div className="text-xs text-white">International Courier & Cargo</div>
              </div>
            </div>
            <p className="text-sm text-white">
              The SkyXpress network stretches across all continents, 
              providing fast, reliable and secure express delivery services worldwide.
            </p>
            <div className="space-y-2 text-sm text-white">
              <p>🌐 www.myskyxpress.com</p>
              <p>📧 skyxpress786@gmail.com</p>
              <p>📞 0326 9422411</p>
              <p>📞 0321 4710522</p>
            </div>
            <div className="flex space-x-4">
              <Facebook className="h-5 w-5 text-white hover:text-primary cursor-pointer transition-colors" />
              <Twitter className="h-5 w-5 text-white hover:text-primary cursor-pointer transition-colors" />
              <Linkedin className="h-5 w-5 text-white hover:text-primary cursor-pointer transition-colors" />
              <Instagram className="h-5 w-5 text-white hover:text-primary cursor-pointer transition-colors" />
            </div>
          </div>

          {/* Services */}
          <div className="space-y-4">
            <h3 className="font-semibold text-white">Services</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/services" className="text-white hover:text-primary transition-colors">
                  E-commerce Solutions
                </Link>
              </li>
              <li>
                <Link to="/services" className="text-white hover:text-primary transition-colors">
                  Airfreight
                </Link>
              </li>
              <li>
                <Link to="/services" className="text-white hover:text-primary transition-colors">
                  Door-to-door
                </Link>
              </li>
              <li>
                <Link to="/services" className="text-white hover:text-primary transition-colors">
                  Return Logistics
                </Link>
              </li>
              <li>
                <Link to="/services" className="text-white hover:text-primary transition-colors">
                  Import Services
                </Link>
              </li>
            </ul>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h3 className="font-semibold text-white">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/track" className="text-white hover:text-primary transition-colors">
                  Track a Shipment
                </Link>
              </li>
              <li>
                <Link to="/quote" className="text-white hover:text-primary transition-colors">
                  Get a Quote
                </Link>
              </li>
              <li>
                <Link to="/network" className="text-white hover:text-primary transition-colors">
                  Our Network
                </Link>
              </li>
              <li>
                <Link to="/about" className="text-white hover:text-primary transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-white hover:text-primary transition-colors">
                  Contact Us
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <h3 className="font-semibold text-white">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/terms" className="text-white hover:text-primary transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-white hover:text-primary transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/shipping-terms" className="text-white hover:text-primary transition-colors">
                  Shipping Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-border">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <p className="text-sm text-white">
              © 2025 SkyXpress International. All rights reserved.
            </p>
            <p className="text-sm text-white mt-2 md:mt-0">
              With more than 40 years of experience in the industry
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
