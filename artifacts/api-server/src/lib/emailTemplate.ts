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
  const ref = parcel.reference_id || parcel.tracking_id || "N/A";
  const tracking = parcel.tracking_id || "N/A";
  const receiverName = parcel.receiver_name || "Valued Customer";
  const currency = parcel.currency || "USD";
  const dims =
    parcel.length && parcel.width && parcel.height
      ? `${parcel.length} × ${parcel.width} × ${parcel.height} cm`
      : "—";
  const serviceType = parcel.service_type
    ? parcel.service_type.replace(/_/g, " ").toUpperCase()
    : "STANDARD";
  const parcelType = parcel.parcel_type
    ? parcel.parcel_type.charAt(0).toUpperCase() + parcel.parcel_type.slice(1)
    : "Package";
  const fromCountry = resolveCountry(parcel.from_country || parcel.sender_country);
  const toCountry = resolveCountry(parcel.to_country || parcel.receiver_country);
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
          <td style="padding:10px 14px;font-size:13px;color:#374151;border-bottom:1px solid #E5E7EB;">${item.description || "—"}</td>
          <td style="padding:10px 14px;font-size:13px;color:#374151;border-bottom:1px solid #E5E7EB;text-align:center;">${item.quantity ?? "—"}</td>
          <td style="padding:10px 14px;font-size:13px;color:#374151;border-bottom:1px solid #E5E7EB;text-align:right;">${currency} ${item.unit_price?.toFixed(2) ?? "—"}</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#0A1628;border-bottom:1px solid #E5E7EB;text-align:right;">${currency} ${item.total?.toFixed(2) ?? "—"}</td>
          ${item.hs_code ? `<td style="padding:10px 14px;font-size:12px;color:#6B7280;border-bottom:1px solid #E5E7EB;">${item.hs_code}</td>` : ""}
        </tr>`
          )
          .join("")
      : "";

  const itemsSection =
    itemsRows
      ? `
    <!-- Items Table -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
      <tr style="background:linear-gradient(135deg,#0A1628,#1E3A5F);">
        <td colspan="${parcel.items?.some(i => i.hs_code) ? 5 : 4}" style="padding:12px 14px;">
          <span style="font-size:12px;font-weight:700;color:#F59E0B;letter-spacing:1.5px;text-transform:uppercase;">📦 Parcel Contents</span>
        </td>
      </tr>
      <tr style="background:#F0F4F8;">
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:left;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">Description</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:center;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">Qty</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:right;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">Unit Price</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:right;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">Total</th>
        ${parcel.items?.some(i => i.hs_code) ? '<th style="padding:10px 14px;font-size:11px;font-weight:700;color:#6B7280;text-align:left;letter-spacing:0.5px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;">HS Code</th>' : ""}
      </tr>
      ${itemsRows}
    </table>`
      : "";

  const receiverBlock = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:4px 0;">
          <span style="font-size:13px;color:#6B7280;">Name: </span>
          <span style="font-size:13px;font-weight:600;color:#0A1628;">${parcel.receiver_name || "—"}</span>
        </td>
      </tr>
      ${parcel.receiver_phone ? `<tr><td style="padding:2px 0;font-size:13px;color:#6B7280;">Phone: ${parcel.receiver_phone}</td></tr>` : ""}
      <tr>
        <td style="padding:2px 0;font-size:13px;color:#6B7280;">
          ${[parcel.receiver_address, parcel.receiver_city, parcel.receiver_state, parcel.receiver_postal_code, parcel.receiver_country].filter(Boolean).join(", ")}
        </td>
      </tr>
    </table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SkyXpress — Parcel X-Ray Clearance</title>
</head>
<body style="margin:0;padding:0;background-color:#EEF2F7;font-family:'Segoe UI',Arial,sans-serif;">

  <!-- Outer Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

          <!-- ═══════════════ HEADER ═══════════════ -->
          <tr>
            <td style="background:linear-gradient(135deg,#0A1628 0%,#1E3A5F 60%,#0D2240 100%);border-radius:12px 12px 0 0;padding:36px 40px 32px;">
              <!-- Logo Area -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <!-- Logo Mark -->
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#F59E0B;border-radius:8px;padding:8px 14px;display:inline-block;">
                          <span style="font-size:22px;font-weight:900;color:#0A1628;letter-spacing:1px;">✈ SKY</span><span style="font-size:22px;font-weight:900;color:#0A1628;letter-spacing:1px;">XPRESS</span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:6px 0 0;font-size:11px;color:#93C5FD;letter-spacing:2px;text-transform:uppercase;">International Courier &amp; Cargo</p>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <!-- X-Rayed Badge -->
                    <table cellpadding="0" cellspacing="0" style="display:inline-block;">
                      <tr>
                        <td style="background:rgba(16,185,129,0.2);border:1.5px solid #10B981;border-radius:20px;padding:6px 16px;">
                          <span style="font-size:12px;font-weight:700;color:#6EE7B7;letter-spacing:1px;">☑ X-RAY CLEARED</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 20px;">
                <tr>
                  <td style="border-top:1px solid rgba(255,255,255,0.12);"></td>
                </tr>
              </table>

              <!-- Headline -->
              <p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#FFFFFF;line-height:1.3;">
                Your Parcel Has Passed<br/>
                <span style="color:#F59E0B;">X-Ray Security Inspection ✓</span>
              </p>
              <p style="margin:10px 0 0;font-size:14px;color:#93C5FD;">
                Dear <strong style="color:#E0F2FE;">${receiverName}</strong> — your shipment has been successfully screened and is cleared for onward processing.
              </p>
            </td>
          </tr>

          <!-- ═══════════════ REFERENCE CARDS ═══════════════ -->
          <tr>
            <td style="background:#FFFFFF;padding:0 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:-1px;border-top:4px solid #F59E0B;">
                <tr>
                  <td style="padding:24px 0 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <!-- Reference ID -->
                        <td width="48%" style="background:#FFF9EE;border:1.5px solid #FCD34D;border-radius:10px;padding:16px 18px;vertical-align:top;">
                          <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#92400E;letter-spacing:1.5px;text-transform:uppercase;">Reference ID</p>
                          <p style="margin:0;font-size:22px;font-weight:900;color:#B45309;letter-spacing:0.5px;">${ref}</p>
                          <p style="margin:4px 0 0;font-size:11px;color:#D97706;">⭐ Keep this for your records</p>
                        </td>
                        <td width="4%"></td>
                        <!-- Tracking Number -->
                        <td width="48%" style="background:#EFF6FF;border:1.5px solid #93C5FD;border-radius:10px;padding:16px 18px;vertical-align:top;">
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

          <!-- ═══════════════ ROUTE BAR ═══════════════ -->
          <tr>
            <td style="background:#FFFFFF;padding:0 40px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0A1628,#1E3A5F);border-radius:10px;overflow:hidden;">
                <tr>
                  <td style="padding:18px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" width="40%">
                          <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#93C5FD;letter-spacing:1.5px;text-transform:uppercase;">Origin</p>
                          <p style="margin:0;font-size:18px;font-weight:900;color:#FFFFFF;">${fromCountry}</p>
                        </td>
                        <td align="center" width="20%">
                          <p style="margin:0;font-size:28px;color:#F59E0B;">✈</p>
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

          <!-- ═══════════════ PARCEL DETAILS ═══════════════ -->
          <tr>
            <td style="background:#FFFFFF;padding:0 40px 28px;">
              <!-- Section Header -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td>
                    <span style="font-size:10px;font-weight:700;color:#6B7280;letter-spacing:2px;text-transform:uppercase;border-left:3px solid #F59E0B;padding-left:10px;">Shipment Details</span>
                  </td>
                  <td align="right">
                    <span style="font-size:11px;color:#9CA3AF;">Processed: ${sentDate}</span>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;">
                <tr>
                  <!-- Dimensions -->
                  <td style="padding:16px;text-align:center;background:#F8FAFC;">
                    <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#374151;letter-spacing:1px;text-transform:uppercase;">📐 Dimensions</p>
                    <p style="margin:0;font-size:14px;font-weight:700;color:#1F2937;">${dims}</p>
                    <p style="margin:2px 0 0;font-size:11px;color:#9CA3AF;">(L × W × H)</p>
                  </td>
                </tr>
                <tr style="background:#F8FAFC;">
                  <td style="padding:12px 16px;border-top:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
                    <p style="margin:0 0 2px;font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Parcel Type</p>
                    <p style="margin:0;font-size:13px;font-weight:600;color:#1F2937;">${parcelType}</p>
                  </td>
                  <td style="padding:12px 16px;border-top:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
                    <p style="margin:0 0 2px;font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Service</p>
                    <p style="margin:0;font-size:13px;font-weight:600;color:#1F2937;">${serviceType}</p>
                  </td>
                  <td style="padding:12px 16px;border-top:1px solid #E5E7EB;">
                    <p style="margin:0 0 2px;font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;">Pieces</p>
                    <p style="margin:0;font-size:13px;font-weight:600;color:#1F2937;">${parcel.pieces ?? 1}</p>
                  </td>
                </tr>
                ${
                  parcel.total_price
                    ? `<tr>
                  <td colspan="3" style="padding:12px 16px;border-top:1px solid #E5E7EB;background:#F0FDF4;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <p style="margin:0 0 2px;font-size:10px;color:#166534;text-transform:uppercase;letter-spacing:0.5px;">💰 Shipping Price</p>
                          <p style="margin:0;font-size:18px;font-weight:900;color:#166534;">${currency} ${parcel.total_price.toFixed(2)}</p>
                        </td>
                        ${
                          parcel.declared_value
                            ? `<td align="right">
                          <p style="margin:0 0 2px;font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;">Declared Value</p>
                          <p style="margin:0;font-size:14px;font-weight:700;color:#374151;">USD ${parcel.declared_value.toFixed(2)}</p>
                        </td>`
                            : ""
                        }
                      </tr>
                    </table>
                  </td>
                </tr>`
                    : ""
                }
              </table>
            </td>
          </tr>

          <!-- ═══════════════ ITEMS TABLE ═══════════════ -->
          ${
            itemsSection
              ? `<tr>
            <td style="background:#FFFFFF;padding:0 40px 28px;">${itemsSection}</td>
          </tr>`
              : ""
          }

          <!-- ═══════════════ DELIVERY ADDRESS ═══════════════ -->
          <tr>
            <td style="background:#FFFFFF;padding:0 40px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;">
                <tr style="background:linear-gradient(135deg,#0A1628,#1E3A5F);">
                  <td style="padding:12px 16px;">
                    <span style="font-size:11px;font-weight:700;color:#F59E0B;letter-spacing:1.5px;text-transform:uppercase;">📍 Delivery Destination</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px;">${receiverBlock}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════════ SPECIAL INSTRUCTIONS ═══════════════ -->
          ${
            parcel.special_instructions
              ? `<tr>
            <td style="background:#FFFFFF;padding:0 40px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF9EE;border:1px solid #FCD34D;border-radius:10px;padding:16px;">
                <tr>
                  <td style="padding:16px;">
                    <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#92400E;letter-spacing:1.5px;text-transform:uppercase;">⚠ Special Instructions</p>
                    <p style="margin:0;font-size:13px;color:#78350F;">${parcel.special_instructions}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
              : ""
          }

          <!-- ═══════════════ INFO BOX ═══════════════ -->
          <tr>
            <td style="background:#FFFFFF;padding:0 40px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#EFF6FF;border-left:4px solid #3B82F6;border-radius:0 8px 8px 0;padding:16px 20px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1E40AF;">ℹ What happens next?</p>
                    <p style="margin:0;font-size:13px;color:#1E3A8A;line-height:1.6;">
                      Your parcel is now cleared for customs review and will proceed to the next stage of its journey. You will receive further updates as your shipment progresses. For any queries, please quote your <strong>Reference ID: ${ref}</strong>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════════ FOOTER ═══════════════ -->
          <tr>
            <td style="background:linear-gradient(135deg,#0A1628,#1E3A5F);border-radius:0 0 12px 12px;padding:32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:16px;font-weight:900;color:#FFFFFF;">✈ SkyXpress International</p>
                    <p style="margin:0 0 16px;font-size:11px;color:#93C5FD;letter-spacing:1px;text-transform:uppercase;">Courier &amp; Cargo Services</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:24px;">
                          <p style="margin:0;font-size:12px;color:#CBD5E1;">📧 SKYXPRESS786@GMAIL.COM</p>
                        </td>
                        <td>
                          <p style="margin:0;font-size:12px;color:#CBD5E1;">🌐 www.myskyxpress.com</p>
                        </td>
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
