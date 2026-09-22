/** Escape a value for safe interpolation into HTML */
function esc(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const COUNTRY_NAMES: Record<string, string> = {
  AF:"Afghanistan",AL:"Albania",DZ:"Algeria",AD:"Andorra",AO:"Angola",AG:"Antigua and Barbuda",AR:"Argentina",AM:"Armenia",AU:"Australia",AT:"Austria",AZ:"Azerbaijan",BS:"Bahamas",BH:"Bahrain",BD:"Bangladesh",BB:"Barbados",BY:"Belarus",BE:"Belgium",BZ:"Belize",BJ:"Benin",BT:"Bhutan",BO:"Bolivia",BA:"Bosnia and Herzegovina",BW:"Botswana",BR:"Brazil",BN:"Brunei",BG:"Bulgaria",BF:"Burkina Faso",BI:"Burundi",CV:"Cabo Verde",KH:"Cambodia",CM:"Cameroon",CA:"Canada",CF:"Central African Republic",TD:"Chad",CL:"Chile",CN:"China",CO:"Colombia",KM:"Comoros",CG:"Congo",CD:"DR Congo",CR:"Costa Rica",CI:"Côte d'Ivoire",HR:"Croatia",CU:"Cuba",CY:"Cyprus",CZ:"Czech Republic",DK:"Denmark",DJ:"Djibouti",DM:"Dominica",DO:"Dominican Republic",EC:"Ecuador",EG:"Egypt",SV:"El Salvador",GQ:"Equatorial Guinea",ER:"Eritrea",EE:"Estonia",SZ:"Eswatini",ET:"Ethiopia",FJ:"Fiji",FI:"Finland",FR:"France",GA:"Gabon",GM:"Gambia",GE:"Georgia",DE:"Germany",GH:"Ghana",GR:"Greece",GD:"Grenada",GT:"Guatemala",GN:"Guinea",GW:"Guinea-Bissau",GY:"Guyana",HT:"Haiti",HN:"Honduras",HU:"Hungary",IS:"Iceland",IN:"India",ID:"Indonesia",IR:"Iran",IQ:"Iraq",IE:"Ireland",IL:"Israel",IT:"Italy",JM:"Jamaica",JP:"Japan",JO:"Jordan",KZ:"Kazakhstan",KE:"Kenya",KI:"Kiribati",KW:"Kuwait",KG:"Kyrgyzstan",LA:"Laos",LV:"Latvia",LB:"Lebanon",LS:"Lesotho",LR:"Liberia",LY:"Libya",LI:"Liechtenstein",LT:"Lithuania",LU:"Luxembourg",MG:"Madagascar",MW:"Malawi",MY:"Malaysia",MV:"Maldives",ML:"Mali",MT:"Malta",MH:"Marshall Islands",MR:"Mauritania",MU:"Mauritius",MX:"Mexico",FM:"Micronesia",MD:"Moldova",MC:"Monaco",MN:"Mongolia",ME:"Montenegro",MA:"Morocco",MZ:"Mozambique",MM:"Myanmar",NA:"Namibia",NR:"Nauru",NP:"Nepal",NL:"Netherlands",NZ:"New Zealand",NI:"Nicaragua",NE:"Niger",NG:"Nigeria",MK:"North Macedonia",NO:"Norway",OM:"Oman",PK:"Pakistan",PW:"Palau",PA:"Panama",PG:"Papua New Guinea",PY:"Paraguay",PE:"Peru",PH:"Philippines",PL:"Poland",PT:"Portugal",QA:"Qatar",RO:"Romania",RU:"Russia",RW:"Rwanda",KN:"Saint Kitts and Nevis",LC:"Saint Lucia",VC:"Saint Vincent and the Grenadines",WS:"Samoa",SM:"San Marino",ST:"São Tomé and Príncipe",SA:"Saudi Arabia",SN:"Senegal",RS:"Serbia",SC:"Seychelles",SL:"Sierra Leone",SG:"Singapore",SK:"Slovakia",SI:"Slovenia",SB:"Solomon Islands",SO:"Somalia",ZA:"South Africa",SS:"South Sudan",ES:"Spain",LK:"Sri Lanka",SD:"Sudan",SR:"Suriname",SE:"Sweden",CH:"Switzerland",SY:"Syria",TW:"Taiwan",TJ:"Tajikistan",TZ:"Tanzania",TH:"Thailand",TL:"Timor-Leste",TG:"Togo",TO:"Tonga",TT:"Trinidad and Tobago",TN:"Tunisia",TR:"Turkey",TM:"Turkmenistan",TV:"Tuvalu",UG:"Uganda",UA:"Ukraine",AE:"United Arab Emirates",GB:"United Kingdom",US:"United States",UY:"Uruguay",UZ:"Uzbekistan",VU:"Vanuatu",VE:"Venezuela",VN:"Vietnam",YE:"Yemen",ZM:"Zambia",ZW:"Zimbabwe",
};

function resolveCountry(code?: string): string {
  if (!code) return "—";
  return COUNTRY_NAMES[code.toUpperCase()] || code;
}

export interface ParcelEmailData {
  reference_id?: string;
  tracking_id?: string;
  sender_name?: string;
  sender_email?: string;
  sender_phone?: string;
  sender_address?: string;
  sender_city?: string;
  sender_country?: string;
  receiver_name?: string;
  receiver_address?: string;
  receiver_city?: string;
  receiver_state?: string;
  receiver_country?: string;
  receiver_postal_code?: string;
  receiver_phone?: string;
  from_country?: string;
  to_country?: string;
  weight?: number;
  chargeable_weight?: number;
  length?: number;
  width?: number;
  height?: number;
  parcel_type?: string;
  service_type?: string;
  document_type?: string;
  declared_value?: number;
  total_price?: number;
  currency?: string;
  special_instructions?: string;
  pieces?: number;
  items?: Array<{
    description?: string;
    quantity?: number;
    unit_price?: number;
    total?: number;
    hs_code?: string;
  }>;
}

export function createXrayEmailHtml(parcel: ParcelEmailData): string {
  const ref = esc(parcel.reference_id || parcel.tracking_id || "N/A");
  const tracking = esc(parcel.tracking_id || "N/A");
  const senderName = esc(parcel.sender_name || "Valued Customer");
  const currency = esc(parcel.currency || "USD");
  // NOTE: weight / chargeable weight / dimensions are intentionally NOT
  // computed or rendered anywhere in this email — they were often
  // placeholder/garbage values (e.g. "1 × 1 × 1 cm") and added noise
  // without value to the recipient. Only meaningful, customer-facing
  // info is shown below.
  const serviceType = esc(
    parcel.service_type ? parcel.service_type.replace(/_/g, " ").toUpperCase() : "STANDARD"
  );
  const parcelType = esc(
    parcel.parcel_type
      ? parcel.parcel_type.charAt(0).toUpperCase() + parcel.parcel_type.slice(1)
      : "Package"
  );
  const fromCountry = esc(resolveCountry(parcel.from_country || parcel.sender_country));
  const toCountry = esc(resolveCountry(parcel.to_country || parcel.receiver_country));
  const sentDate = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const itemsRows =
    parcel.items && parcel.items.length > 0
      ? parcel.items
          .map(
            (item, i) => `
        <tr style="background:${i % 2 === 0 ? "#F8FAFC" : "#FFFFFF"};">
          <td style="padding:12px 14px;font-size:13px;color:#374151;border-bottom:1px solid #EEF1F5;">${esc(item.description)}</td>
          <td style="padding:12px 14px;font-size:13px;color:#374151;border-bottom:1px solid #EEF1F5;text-align:center;">${item.quantity ?? "—"}</td>
          <td style="padding:12px 14px;font-size:13px;color:#374151;border-bottom:1px solid #EEF1F5;text-align:right;">${currency} ${item.unit_price?.toFixed(2) ?? "—"}</td>
          <td style="padding:12px 14px;font-size:13px;font-weight:700;color:#0A1628;border-bottom:1px solid #EEF1F5;text-align:right;">${currency} ${item.total?.toFixed(2) ?? "—"}</td>
          ${item.hs_code ? `<td style="padding:12px 14px;font-size:12px;color:#6B7280;border-bottom:1px solid #EEF1F5;">${esc(item.hs_code)}</td>` : ""}
        </tr>`
          )
          .join("")
      : "";

  const itemsSection =
    itemsRows
      ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
      <tr style="background:linear-gradient(135deg,#0A1628,#1E3A5F);">
        <td colspan="${parcel.items?.some(i => i.hs_code) ? 5 : 4}" style="padding:14px 16px;">
          <span style="font-size:12px;font-weight:700;color:#F59E0B;letter-spacing:1.5px;text-transform:uppercase;">📦 Parcel Contents</span>
        </td>
      </tr>
      <tr style="background:#F5F7FA;">
        <th style="padding:11px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:left;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">Description</th>
        <th style="padding:11px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:center;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">Qty</th>
        <th style="padding:11px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:right;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">Unit Price</th>
        <th style="padding:11px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:right;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">Total</th>
        ${parcel.items?.some(i => i.hs_code) ? '<th style="padding:11px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:left;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">HS Code</th>' : ""}
      </tr>
      ${itemsRows}
    </table>`
      : "";

  const receiverBlock = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:4px 0;">
          <span style="font-size:13px;color:#6B7280;">Name: </span>
          <span style="font-size:13px;font-weight:600;color:#0A1628;">${esc(parcel.receiver_name)}</span>
        </td>
      </tr>
      ${parcel.receiver_phone ? `<tr><td style="padding:2px 0;font-size:13px;color:#6B7280;">Phone: ${esc(parcel.receiver_phone)}</td></tr>` : ""}
      <tr>
        <td style="padding:2px 0;font-size:13px;color:#6B7280;">
          ${[parcel.receiver_address, parcel.receiver_city, parcel.receiver_state, parcel.receiver_postal_code, parcel.receiver_country].filter(Boolean).map(esc).join(", ")}
        </td>
      </tr>
    </table>`;

  // ── Shipment Details — 3 clean icon cards (Parcel Type / Service / Pieces) ──
  // Weight, chargeable weight and dimensions are deliberately omitted.
  const detailCards = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="32%" valign="top" style="background:linear-gradient(160deg,#FFF7ED,#FFFFFF);border:1px solid #FDE7C6;border-radius:12px;padding:18px 14px;text-align:center;">
          <div style="width:38px;height:38px;line-height:38px;margin:0 auto 10px;background:#FEF3E2;border-radius:50%;font-size:18px;">📦</div>
          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#9A6B1E;letter-spacing:1px;text-transform:uppercase;">Parcel Type</p>
          <p style="margin:0;font-size:15px;font-weight:800;color:#7C4A0A;">${parcelType}</p>
        </td>
        <td width="2%"></td>
        <td width="32%" valign="top" style="background:linear-gradient(160deg,#EFF6FF,#FFFFFF);border:1px solid #C7DCFB;border-radius:12px;padding:18px 14px;text-align:center;">
          <div style="width:38px;height:38px;line-height:38px;margin:0 auto 10px;background:#E4EEFF;border-radius:50%;font-size:18px;">🚚</div>
          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#1E4FA0;letter-spacing:1px;text-transform:uppercase;">Service</p>
          <p style="margin:0;font-size:15px;font-weight:800;color:#1E3A8A;">${serviceType}</p>
        </td>
        <td width="2%"></td>
        <td width="32%" valign="top" style="background:linear-gradient(160deg,#F0FDF4,#FFFFFF);border:1px solid #BFEAD0;border-radius:12px;padding:18px 14px;text-align:center;">
          <div style="width:38px;height:38px;line-height:38px;margin:0 auto 10px;background:#DDF6E5;border-radius:50%;font-size:18px;">🔢</div>
          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#1D7A46;letter-spacing:1px;text-transform:uppercase;">Pieces</p>
          <p style="margin:0;font-size:15px;font-weight:800;color:#166534;">${esc(parcel.pieces ?? 1)}</p>
        </td>
      </tr>
    </table>`;

  const priceBlock = parcel.total_price
    ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:linear-gradient(135deg,#ECFDF5,#F0FDF4);border:1px solid #BBF7D0;border-radius:12px;">
      <tr>
        <td style="padding:16px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top">
                <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#166534;letter-spacing:1px;text-transform:uppercase;">💰 Shipping Price</p>
                <p style="margin:0;font-size:22px;font-weight:900;color:#15803D;">${currency} ${parcel.total_price.toFixed(2)}</p>
              </td>
              ${
                parcel.declared_value
                  ? `<td align="right" valign="top">
                <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#6B7280;letter-spacing:1px;text-transform:uppercase;">Declared Value</p>
                <p style="margin:0;font-size:16px;font-weight:700;color:#374151;">USD ${parcel.declared_value.toFixed(2)}</p>
              </td>`
                  : ""
              }
            </tr>
          </table>
        </td>
      </tr>
    </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SkyXpress — Parcel X-Ray Clearance</title>
</head>
<body style="margin:0;padding:0;background-color:#EEF2F7;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(10,22,40,0.10);">
          <tr>
            <td style="background:linear-gradient(135deg,#0A1628 0%,#1E3A5F 60%,#0D2240 100%);padding:36px 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#F59E0B;border-radius:8px;padding:8px 14px;">
                          <span style="font-size:22px;font-weight:900;color:#0A1628;letter-spacing:1px;">✈ SKYXPRESS</span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:6px 0 0;font-size:11px;color:#93C5FD;letter-spacing:2px;text-transform:uppercase;">International Courier &amp; Cargo</p>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:rgba(16,185,129,0.2);border:1.5px solid #10B981;border-radius:20px;padding:6px 16px;">
                          <span style="font-size:12px;font-weight:700;color:#6EE7B7;letter-spacing:1px;">☑ X-RAY CLEARED</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 20px;">
                <tr><td style="border-top:1px solid rgba(255,255,255,0.12);"></td></tr>
              </table>
              <p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#FFFFFF;line-height:1.3;">
                Your Parcel Has Passed<br/>
                <span style="color:#F59E0B;">X-Ray Security Inspection ✓</span>
              </p>
              <p style="margin:10px 0 0;font-size:14px;color:#93C5FD;">
                Dear <strong style="color:#E0F2FE;">${senderName}</strong> — your shipment has been successfully screened and is cleared for onward processing.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:-1px;border-top:4px solid #F59E0B;">
                <tr>
                  <td style="padding:24px 0 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="48%" style="background:#FFF9EE;border:1.5px solid #FCD34D;border-radius:12px;padding:16px 18px;vertical-align:top;">
                          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#92400E;letter-spacing:1.5px;text-transform:uppercase;">Reference ID</p>
                          <p style="margin:0;font-size:22px;font-weight:900;color:#B45309;letter-spacing:0.5px;">${ref}</p>
                          <p style="margin:4px 0 0;font-size:11px;color:#D97706;">⭐ Keep this for your records</p>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="background:#EFF6FF;border:1.5px solid #93C5FD;border-radius:12px;padding:16px 18px;vertical-align:top;">
                          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#1E3A8A;letter-spacing:1.5px;text-transform:uppercase;">Tracking Number</p>
                          <p style="margin:0;font-size:16px;font-weight:800;color:#1D4ED8;letter-spacing:0.5px;word-break:break-all;">${tracking}</p>
                          <p style="margin:4px 0 0;font-size:11px;color:#3B82F6;">🔍 Track on www.myskyxpress.com</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0A1628,#1E3A5F);border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" width="40%">
                          <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#93C5FD;letter-spacing:1.5px;text-transform:uppercase;">Origin</p>
                          <p style="margin:0;font-size:18px;font-weight:900;color:#FFFFFF;">${fromCountry}</p>
                        </td>
                        <td align="center" width="20%">
                          <p style="margin:0;font-size:30px;color:#F59E0B;">✈</p>
                        </td>
                        <td align="center" width="40%">
                          <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#93C5FD;letter-spacing:1.5px;text-transform:uppercase;">Destination</p>
                          <p style="margin:0;font-size:18px;font-weight:900;color:#FFFFFF;">${toCountry}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- ═══════════════ SHIPMENT DETAILS (no weight/dimensions) ═══════════════ -->
          <tr>
            <td style="padding:0 40px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td><span style="font-size:10px;font-weight:700;color:#6B7280;letter-spacing:2px;text-transform:uppercase;border-left:3px solid #F59E0B;padding-left:10px;">Shipment Details</span></td>
                  <td align="right"><span style="font-size:11px;color:#9CA3AF;">Processed: ${esc(sentDate)}</span></td>
                </tr>
              </table>
              ${detailCards}
              ${priceBlock}
            </td>
          </tr>
          ${itemsSection ? `<tr><td style="padding:0 40px 28px;">${itemsSection}</td></tr>` : ""}
          <tr>
            <td style="padding:0 40px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
                <tr style="background:linear-gradient(135deg,#0A1628,#1E3A5F);">
                  <td style="padding:12px 16px;"><span style="font-size:11px;font-weight:700;color:#F59E0B;letter-spacing:1.5px;text-transform:uppercase;">📍 Delivery Destination</span></td>
                </tr>
                <tr><td style="padding:18px 16px;">${receiverBlock}</td></tr>
              </table>
            </td>
          </tr>
          ${parcel.special_instructions ? `
          <tr>
            <td style="padding:0 40px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF9EE;border:1px solid #FCD34D;border-radius:12px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#92400E;letter-spacing:1.5px;text-transform:uppercase;">⚠ Special Instructions</p>
                    <p style="margin:0;font-size:13px;color:#78350F;">${esc(parcel.special_instructions)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : ""}
          <tr>
            <td style="padding:0 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#EFF6FF;border-left:4px solid #3B82F6;border-radius:0 12px 12px 0;">
                <tr>
                  <td style="padding:18px 22px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1E40AF;">ℹ What happens next?</p>
                    <p style="margin:0;font-size:13px;color:#1E3A8A;line-height:1.6;">
                      Your parcel is now cleared for customs review and will proceed to the next stage of its journey. You will receive further updates as your shipment progresses. For any queries, please quote your <strong>Reference ID: ${ref}</strong>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:linear-gradient(135deg,#0A1628,#1E3A5F);padding:32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:16px;font-weight:900;color:#FFFFFF;">✈ SkyXpress International</p>
                    <p style="margin:0 0 16px;font-size:11px;color:#93C5FD;letter-spacing:1px;text-transform:uppercase;">Courier &amp; Cargo Services</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:24px;"><p style="margin:0;font-size:12px;color:#CBD5E1;">📧 SKYXPRESS786@GMAIL.COM</p></td>
                        <td><p style="margin:0;font-size:12px;color:#CBD5E1;">🌐 www.myskyxpress.com</p></td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align:bottom;">
                    <p style="margin:0;font-size:11px;color:#64748B;text-align:right;">This is an automated notification.<br/>Please do not reply to this email.</p>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.1);">
                    <p style="margin:0;font-size:11px;color:#475569;text-align:center;">
                      © ${new Date().getFullYear()} SkyXpress International Courier &amp; Cargo. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
