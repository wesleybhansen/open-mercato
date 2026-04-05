export const TEMPLATE_CSS = `
        *, *::before, *::after {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --white: #ffffff;
            --warm-bg: #F7F6F3;
            --warm-bg-dark: #EFEDEA;
            --text: #37352F;
            --text-secondary: #787774;
            --text-muted: #9B9A97;
            --border: #E9E8E4;
            --tomato: #EB5757;
            --tomato-hover: #E04040;
            --tomato-bg: rgba(235, 87, 87, 0.08);
            --orange: #FFA344;
            --orange-bg: rgba(255, 163, 68, 0.08);
            --blue: #529CCA;
            --blue-bg: rgba(82, 156, 202, 0.08);
            --green: #4DAB9A;
            --green-bg: rgba(77, 171, 154, 0.08);
            --purple: #9A6DD7;
            --purple-bg: rgba(154, 109, 215, 0.08);
            --yellow: #DFAB01;
            --yellow-bg: rgba(223, 171, 1, 0.08);
            --shadow: 0 1px 3px rgba(0,0,0,0.08);
            --shadow-hover: 0 4px 12px rgba(0,0,0,0.1);
            --font: 'Nunito', -apple-system, sans-serif;
            --container: 1060px;
            --radius: 10px;
            --radius-lg: 16px;
            --radius-pill: 100px;
            --transition: 0.25s ease;
        }

        html {
            scroll-behavior: smooth;
            -webkit-font-smoothing: antialiased;
        }

        body {
            font-family: var(--font);
            background: var(--white);
            color: var(--text);
            font-size: 16px;
            line-height: 1.65;
            font-weight: 400;
            overflow-x: hidden;
        }

        .container {
            max-width: var(--container);
            margin: 0 auto;
            padding: 0 28px;
        }

        h1, h2, h3 {
            font-weight: 700;
            line-height: 1.2;
            color: var(--text);
        }

        h1 { font-size: clamp(32px, 4vw, 46px); letter-spacing: -0.5px; }
        h2 { font-size: clamp(26px, 3vw, 34px); letter-spacing: -0.3px; }
        h3 { font-size: 18px; }

        a { color: inherit; text-decoration: none; }
        p { color: var(--text-secondary); }

        /* Tags */
        .tag {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 600;
            padding: 3px 10px;
            border-radius: var(--radius-pill);
        }

        .tag-tomato { background: var(--tomato-bg); color: var(--tomato); }
        .tag-orange { background: var(--orange-bg); color: var(--orange); }
        .tag-blue { background: var(--blue-bg); color: var(--blue); }
        .tag-green { background: var(--green-bg); color: var(--green); }
        .tag-purple { background: var(--purple-bg); color: var(--purple); }
        .tag-yellow { background: var(--yellow-bg); color: var(--yellow); }

        /* Buttons */
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-family: var(--font);
            font-size: 15px;
            font-weight: 600;
            padding: 12px 28px;
            border-radius: var(--radius-pill);
            border: none;
            cursor: pointer;
            transition: all var(--transition);
        }

        .btn-tomato {
            background: var(--tomato);
            color: #fff;
        }

        .btn-tomato:hover {
            background: var(--tomato-hover);
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(235, 87, 87, 0.25);
        }

        .btn-outline {
            background: var(--white);
            color: var(--text);
            border: 1.5px solid var(--border);
        }

        .btn-outline:hover {
            border-color: var(--text-muted);
            background: var(--warm-bg);
        }

        .btn svg {
            width: 16px;
            height: 16px;
            stroke: currentColor;
            stroke-width: 2;
            fill: none;
        }

        /* Callout Box */
        .callout {
            border-left: 4px solid;
            border-radius: var(--radius);
            padding: 20px 24px;
        }

        .callout-tomato { border-color: var(--tomato); background: var(--tomato-bg); }
        .callout-blue { border-color: var(--blue); background: var(--blue-bg); }
        .callout-green { border-color: var(--green); background: var(--green-bg); }
        .callout-orange { border-color: var(--orange); background: var(--orange-bg); }
        .callout-purple { border-color: var(--purple); background: var(--purple-bg); }

        /* Scroll Reveal */
        .reveal {
            opacity: 0;
            transform: translateY(14px);
            transition: opacity 0.5s ease, transform 0.5s ease;
        }

        .reveal.visible {
            opacity: 1;
            transform: translateY(0);
        }

        /* ==================== NAVIGATION ==================== */
        .nav {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 100;
            background: rgba(255,255,255,0.92);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--border);
        }

        .nav-inner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 60px;
        }

        .nav-logo {
            font-size: 20px;
            font-weight: 800;
            color: var(--text);
        }

        .nav-logo span {
            color: var(--tomato);
        }

        .nav-links {
            display: flex;
            gap: 28px;
            list-style: none;
        }

        .nav-links a {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-secondary);
            transition: color var(--transition);
        }

        .nav-links a:hover {
            color: var(--text);
        }

        .nav-cta {
            font-size: 13px;
            font-weight: 700;
            padding: 8px 20px;
            background: var(--tomato);
            color: #fff;
            border-radius: var(--radius-pill);
            transition: all var(--transition);
        }

        .nav-cta:hover {
            background: var(--tomato-hover);
        }

        .nav-mobile-toggle {
            display: none;
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
        }

        .nav-mobile-toggle svg {
            width: 22px;
            height: 22px;
            stroke: var(--text);
            stroke-width: 1.5;
            fill: none;
        }

        /* ==================== HERO ==================== */
        .hero {
            padding: 140px 0 120px;
            min-height: 90vh;
            display: flex;
            align-items: center;
        }

        .hero-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 56px;
            align-items: center;
        }

        .hero-tag {
            margin-bottom: 16px;
        }

        .hero h1 {
            margin-bottom: 16px;
        }

        .hero-desc {
            font-size: 17px;
            line-height: 1.7;
            color: var(--text-secondary);
            margin-bottom: 28px;
            max-width: 440px;
        }

        .hero-buttons {
            display: flex;
            gap: 12px;
            margin-bottom: 28px;
            flex-wrap: wrap;
        }

        .hero-social-proof {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .avatar-group {
            display: flex;
        }

        .avatar-circle {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            border: 2px solid var(--white);
            margin-left: -8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 700;
            color: #fff;
        }

        .avatar-circle:first-child { margin-left: 0; }
        .avatar-circle:nth-child(1) { background: var(--blue); }
        .avatar-circle:nth-child(2) { background: var(--green); }
        .avatar-circle:nth-child(3) { background: var(--orange); }
        .avatar-circle:nth-child(4) { background: var(--purple); }
        .avatar-circle:nth-child(5) { background: var(--tomato); }

        .hero-social-text {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-secondary);
        }

        .hero-social-text strong {
            color: var(--text);
        }

        .hero-visual {
            background: var(--warm-bg);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
            min-height: 380px;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
        }

        .hero-visual svg {
            width: 48px;
            height: 48px;
            stroke: var(--text-muted);
            stroke-width: 1;
            fill: none;
        }

        /* ==================== WHAT YOU'LL LEARN ==================== */
        .learn {
            padding: 80px 0 100px;
            background: var(--warm-bg);
        }

        .learn-header {
            text-align: center;
            margin-bottom: 48px;
        }

        .learn-header p {
            max-width: 460px;
            margin: 12px auto 0;
            font-size: 16px;
        }

        .learn-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
        }

        .learn-card {
            background: var(--white);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 24px;
            transition: all var(--transition);
        }

        .learn-card:hover {
            box-shadow: var(--shadow-hover);
            transform: translateY(-2px);
        }

        .learn-card .tag {
            margin-bottom: 12px;
        }

        .learn-card h3 {
            margin-bottom: 8px;
            font-size: 16px;
        }

        .learn-card p {
            font-size: 14px;
            line-height: 1.6;
        }

        /* ==================== HIGHLIGHTS ==================== */
        .highlights {
            padding: 80px 0 100px;
        }

        .highlights-header {
            text-align: center;
            margin-bottom: 48px;
        }

        .highlights-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }

        .highlight-card {
            background: var(--white);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            overflow: hidden;
            transition: all var(--transition);
        }

        .highlight-card:hover {
            box-shadow: var(--shadow-hover);
        }

        .highlight-accent {
            height: 4px;
        }

        .highlight-accent.tomato { background: var(--tomato); }
        .highlight-accent.blue { background: var(--blue); }
        .highlight-accent.green { background: var(--green); }

        .highlight-body {
            padding: 28px;
        }

        .highlight-icon {
            width: 44px;
            height: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--warm-bg);
            border-radius: var(--radius);
            margin-bottom: 16px;
        }

        .highlight-icon svg {
            width: 22px;
            height: 22px;
            stroke: var(--text);
            stroke-width: 1.5;
            fill: none;
        }

        .highlight-card h3 {
            margin-bottom: 8px;
        }

        .highlight-card p {
            font-size: 14px;
            line-height: 1.6;
        }

        /* ==================== CURRICULUM ==================== */
        .curriculum {
            padding: 80px 0 100px;
            background: var(--warm-bg);
        }

        .curriculum-header {
            text-align: center;
            margin-bottom: 48px;
        }

        .curriculum-header p {
            max-width: 420px;
            margin: 12px auto 0;
        }

        .curriculum-list {
            max-width: 680px;
            margin: 0 auto;
        }

        .module-item {
            background: var(--white);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            margin-bottom: 8px;
            overflow: hidden;
        }

        .module-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 18px 22px;
            cursor: pointer;
            gap: 16px;
            background: none;
            border: none;
            width: 100%;
            text-align: left;
            font-family: var(--font);
            transition: background var(--transition);
        }

        .module-header:hover {
            background: var(--warm-bg);
        }

        .module-header-left {
            display: flex;
            align-items: center;
            gap: 14px;
        }

        .module-chevron {
            width: 18px;
            height: 18px;
            transition: transform 0.25s ease;
        }

        .module-chevron svg {
            width: 18px;
            height: 18px;
            stroke: var(--text-muted);
            stroke-width: 2;
            fill: none;
        }

        .module-item.active .module-chevron {
            transform: rotate(90deg);
        }

        .module-title {
            font-size: 15px;
            font-weight: 600;
            color: var(--text);
        }

        .module-meta {
            font-size: 12px;
            color: var(--text-muted);
            font-weight: 500;
            white-space: nowrap;
        }

        .module-lessons {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.35s ease;
        }

        .module-item.active .module-lessons {
            max-height: 500px;
        }

        .module-lessons-inner {
            padding: 0 22px 18px;
            border-top: 1px solid var(--border);
            padding-top: 14px;
        }

        .lesson-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 7px 0;
            font-size: 14px;
            color: var(--text-secondary);
        }

        .lesson-check {
            width: 16px;
            height: 16px;
            border: 1.5px solid var(--border);
            border-radius: 4px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .lesson-check svg {
            width: 10px;
            height: 10px;
            stroke: var(--green);
            stroke-width: 2.5;
            fill: none;
            display: none;
        }

        .lesson-row.done .lesson-check {
            background: var(--green-bg);
            border-color: var(--green);
        }

        .lesson-row.done .lesson-check svg {
            display: block;
        }

        /* ==================== INSTRUCTOR ==================== */
        .instructor {
            padding: 80px 0 100px;
        }

        .instructor-grid {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 40px;
            align-items: center;
            max-width: 720px;
            margin: 0 auto;
        }

        .instructor-avatar {
            width: 140px;
            height: 140px;
            border-radius: 50%;
            background: var(--warm-bg);
            border: 3px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .instructor-avatar svg {
            width: 40px;
            height: 40px;
            stroke: var(--text-muted);
            stroke-width: 1;
            fill: none;
        }

        .instructor-name {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .instructor-title {
            font-size: 14px;
            color: var(--text-muted);
            margin-bottom: 14px;
        }

        .instructor-bio {
            font-size: 15px;
            line-height: 1.7;
            color: var(--text-secondary);
            margin-bottom: 16px;
        }

        .instructor-badges {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        /* ==================== SOCIAL PROOF ==================== */
        .social-proof {
            padding: 80px 0 100px;
            background: var(--warm-bg);
        }

        .proof-callout {
            text-align: center;
            margin-bottom: 48px;
        }

        .proof-callout .callout {
            display: inline-flex;
            align-items: center;
            gap: 16px;
            padding: 16px 28px;
            border-left: 4px solid var(--tomato);
            background: var(--tomato-bg);
            border-radius: var(--radius);
        }

        .proof-stat {
            font-size: 20px;
            font-weight: 700;
            color: var(--text);
        }

        .proof-label {
            font-size: 14px;
            color: var(--text-secondary);
        }

        .proof-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }

        .proof-card {
            background: var(--white);
            border-radius: var(--radius);
            padding: 28px;
            border-left: 4px solid;
            box-shadow: var(--shadow);
        }

        .proof-card:nth-child(1) { border-color: var(--blue); }
        .proof-card:nth-child(2) { border-color: var(--green); }
        .proof-card:nth-child(3) { border-color: var(--purple); }

        .proof-quote {
            font-size: 15px;
            line-height: 1.65;
            color: var(--text);
            font-style: italic;
            margin-bottom: 18px;
        }

        .proof-author {
            font-size: 14px;
            font-weight: 600;
            color: var(--text);
        }

        .proof-result {
            font-size: 12px;
            font-weight: 600;
            color: var(--green);
            margin-top: 2px;
        }

        /* ==================== PRICING ==================== */
        .pricing {
            padding: 80px 0 100px;
        }

        .pricing-header {
            text-align: center;
            margin-bottom: 48px;
        }

        .pricing-header p {
            max-width: 420px;
            margin: 12px auto 0;
        }

        .pricing-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            max-width: 700px;
            margin: 0 auto;
        }

        .pricing-card {
            background: var(--white);
            border: 1.5px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 36px;
            position: relative;
            transition: all var(--transition);
        }

        .pricing-card:hover {
            box-shadow: var(--shadow-hover);
        }

        .pricing-card.featured {
            border-color: var(--tomato);
        }

        .pricing-badge {
            position: absolute;
            top: -12px;
            right: 24px;
            background: var(--tomato);
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            padding: 4px 14px;
            border-radius: var(--radius-pill);
        }

        .pricing-plan {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: 8px;
        }

        .pricing-price {
            font-size: 42px;
            font-weight: 800;
            color: var(--text);
            letter-spacing: -1px;
            line-height: 1;
            margin-bottom: 4px;
        }

        .pricing-desc {
            font-size: 13px;
            color: var(--text-muted);
            margin-bottom: 24px;
        }

        .pricing-btn {
            display: block;
            width: 100%;
            text-align: center;
            padding: 12px;
            font-family: var(--font);
            font-size: 14px;
            font-weight: 700;
            border-radius: var(--radius-pill);
            cursor: pointer;
            transition: all var(--transition);
            margin-bottom: 24px;
            border: 1.5px solid var(--border);
            background: var(--white);
            color: var(--text);
        }

        .pricing-btn:hover {
            background: var(--warm-bg);
        }

        .pricing-card.featured .pricing-btn {
            background: var(--tomato);
            border-color: var(--tomato);
            color: #fff;
        }

        .pricing-card.featured .pricing-btn:hover {
            background: var(--tomato-hover);
        }

        .pricing-features {
            list-style: none;
        }

        .pricing-features li {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
            color: var(--text-secondary);
            padding: 6px 0;
        }

        .pricing-features li svg {
            width: 16px;
            height: 16px;
            stroke: var(--green);
            stroke-width: 2;
            fill: none;
            flex-shrink: 0;
        }

        /* ==================== FAQ ==================== */
        .faq {
            padding: 80px 0 100px;
            background: var(--warm-bg);
        }

        .faq-header {
            text-align: center;
            margin-bottom: 48px;
        }

        .faq-list {
            max-width: 660px;
            margin: 0 auto;
        }

        .faq-item {
            background: var(--white);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            margin-bottom: 8px;
            overflow: hidden;
        }

        .faq-question {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 18px 22px;
            cursor: pointer;
            background: none;
            border: none;
            width: 100%;
            text-align: left;
            font-family: var(--font);
            font-size: 15px;
            font-weight: 600;
            color: var(--text);
            transition: background var(--transition);
        }

        .faq-question:hover {
            background: var(--warm-bg);
        }

        .faq-chevron {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            transition: transform 0.25s ease;
        }

        .faq-chevron svg {
            width: 16px;
            height: 16px;
            stroke: var(--text-muted);
            stroke-width: 2;
            fill: none;
        }

        .faq-item.active .faq-chevron {
            transform: rotate(90deg);
        }

        .faq-answer {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.35s ease;
        }

        .faq-item.active .faq-answer {
            max-height: 200px;
        }

        .faq-answer-inner {
            padding: 0 22px 18px 52px;
        }

        .faq-answer p {
            font-size: 14px;
            line-height: 1.7;
        }

        /* ==================== FINAL CTA ==================== */
        .final-cta {
            padding: 80px 0;
            text-align: center;
        }

        .final-cta h2 {
            margin-bottom: 12px;
        }

        .final-cta p {
            max-width: 400px;
            margin: 0 auto 28px;
            font-size: 16px;
        }

        .final-cta .btn {
            margin-bottom: 14px;
        }

        .guarantee {
            font-size: 13px;
            color: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        .guarantee svg {
            width: 14px;
            height: 14px;
            stroke: var(--green);
            stroke-width: 2;
            fill: none;
        }

        /* ==================== FOOTER ==================== */
        .footer {
            padding: 48px 0 32px;
            border-top: 1px solid var(--border);
            background: var(--warm-bg);
        }

        .footer-grid {
            display: grid;
            grid-template-columns: 1.5fr 1fr 1fr;
            gap: 40px;
            margin-bottom: 32px;
        }

        .footer-brand p {
            font-size: 14px;
            color: var(--text-muted);
            line-height: 1.6;
            margin-top: 10px;
            max-width: 260px;
        }

        .footer-col h4 {
            font-size: 13px;
            font-weight: 700;
            color: var(--text);
            margin-bottom: 14px;
        }

        .footer-col ul {
            list-style: none;
        }

        .footer-col li {
            margin-bottom: 8px;
        }

        .footer-col a {
            font-size: 14px;
            color: var(--text-muted);
            transition: color var(--transition);
        }

        .footer-col a:hover {
            color: var(--text);
        }

        .footer-bottom {
            padding-top: 20px;
            border-top: 1px solid var(--border);
            font-size: 13px;
            color: var(--text-muted);
            text-align: center;
        }

        /* ==================== MOBILE NAV ==================== */
        .mobile-nav {
            display: none;
            position: fixed;
            top: 60px;
            left: 0;
            right: 0;
            background: rgba(255,255,255,0.98);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--border);
            padding: 12px 28px 20px;
            z-index: 99;
            transform: translateY(-6px);
            opacity: 0;
            pointer-events: none;
            transition: all 0.25s ease;
        }

        .mobile-nav.open {
            transform: translateY(0);
            opacity: 1;
            pointer-events: all;
        }

        .mobile-nav a {
            display: block;
            font-size: 15px;
            color: var(--text-secondary);
            padding: 12px 0;
            border-bottom: 1px solid var(--border);
        }

        .mobile-nav a:last-child {
            border-bottom: none;
            color: var(--tomato);
            font-weight: 600;
        }

        /* ==================== RESPONSIVE ==================== */
        @media (max-width: 768px) {
            .nav-links { display: none; }
            .nav-mobile-toggle { display: block; }
            .mobile-nav { display: block; }

            .hero { padding: 110px 0 60px; }
            .hero-grid { grid-template-columns: 1fr; gap: 32px; }
            .learn-grid, .highlights-grid, .who-grid { grid-template-columns: 1fr !important; }
            .highlights-grid { grid-template-columns: 1fr; }
            .proof-grid { grid-template-columns: 1fr; }
            .pricing-grid { grid-template-columns: 1fr; max-width: 380px; }
            .instructor-grid { grid-template-columns: 1fr; text-align: center; }
            .instructor-avatar { margin: 0 auto; }
            .instructor-badges { justify-content: center; }
            .footer-grid { grid-template-columns: 1fr; gap: 24px; }
        }

        @media (max-width: 480px) {
            .container { padding: 0 20px; }
            .hero { padding: 100px 0 48px; }
            .hero-buttons { flex-direction: column; }
            .hero-buttons .btn { text-align: center; justify-content: center; }
        }

        /* Enrollment form */
        .pricing-section { padding: 80px 0; }
        .pricing-section .pricing-header { text-align: center; margin-bottom: 40px; }
        .pricing-section .pricing-header h2 { font-size: 32px; font-weight: 800; margin-bottom: 8px; }
        .pricing-section .pricing-header p { color: var(--text-secondary); }
        .enroll-card { background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 40px; max-width: 480px; margin: 0 auto; position: relative; }
        .enroll-card.featured { border-color: var(--tomato); box-shadow: 0 0 0 1px var(--tomato), var(--shadow-hover); }
        .enroll-card .pricing-price { font-size: 48px; font-weight: 800; color: var(--text); letter-spacing: -1.5px; line-height: 1; margin-bottom: 6px; text-align: center; }
        .enroll-card .pricing-desc { font-size: 14px; color: var(--text-muted); margin-bottom: 28px; text-align: center; }
        .enroll-card .pricing-features { list-style: none; margin-bottom: 28px; }
        .enroll-card .pricing-features li { display: flex; align-items: center; gap: 12px; font-size: 15px; color: var(--text-secondary); padding: 8px 0; }
        .enroll-card .pricing-features li svg { width: 16px; height: 16px; stroke: var(--green); stroke-width: 2.5; fill: none; flex-shrink: 0; }
        .enroll-form .field { margin-bottom: 14px; }
        .enroll-form .field label { display: block; font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
        .enroll-form .field input, .enroll-form .field select, .enroll-form .field textarea { width: 100%; padding: 12px 14px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 15px; font-family: var(--font); color: var(--text); background: var(--white); transition: border-color var(--transition); outline: none; box-sizing: border-box; }
        .enroll-form .field input:focus, .enroll-form .field select:focus, .enroll-form .field textarea:focus { border-color: var(--tomato); }
        .enroll-form .field input::placeholder, .enroll-form .field textarea::placeholder { color: var(--text-muted); }
        .enroll-form .field select option { background: var(--white); color: var(--text); }
        .enroll-form .field textarea { resize: vertical; min-height: 80px; }
        .enroll-form .options { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
        .enroll-form .check-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-secondary); cursor: pointer; padding: 8px 12px; border: 1.5px solid var(--border); border-radius: var(--radius); transition: border-color var(--transition); }
        .enroll-form .check-label:hover { border-color: var(--text-muted); }
        .enroll-form .check-label input { width: auto; margin: 0; accent-color: var(--tomato); }
        .enroll-btn { display: block; width: 100%; padding: 14px; background: var(--tomato); color: #fff; border: none; border-radius: var(--radius); font-size: 16px; font-weight: 700; cursor: pointer; font-family: var(--font); transition: background var(--transition); margin-top: 8px; }
        .enroll-btn:hover { background: var(--tomato-hover); }
        .enroll-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .error { background: rgba(235,87,87,0.08); color: #b91c1c; padding: 10px 14px; border-radius: var(--radius); font-size: 13px; margin-bottom: 14px; display: none; }
        .success { text-align: center; padding: 24px 0; }
        .success h3 { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
        .success p { color: var(--text-secondary); font-size: 14px; }
        .terms-check { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-secondary); cursor: pointer; padding: 14px 0 10px; }
        .terms-box { background: var(--warm-bg); border-radius: var(--radius); padding: 14px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; max-height: 160px; overflow-y: auto; margin: 8px 0 12px; display: none; }
        .who-section { padding: 64px 0; }
        .who-section .who-header { text-align: center; margin-bottom: 32px; }
        .who-section .who-header h2 { font-size: 32px; font-weight: 800; }
        .who-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-width: 920px; margin: 0 auto; }
        .who-card { background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 32px 28px; text-align: center; transition: all var(--transition); }
        .who-card:hover { border-color: var(--tomato); box-shadow: var(--shadow-hover); }
        .who-icon { width: 40px; height: 40px; margin: 0 auto 14px; background: var(--tomato-bg); border-radius: 10px; display: flex; align-items: center; justify-content: center; }
        .who-icon svg { width: 20px; height: 20px; stroke: var(--tomato); stroke-width: 1.5; fill: none; }
        .who-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
        .who-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.65; }
        @media (max-width: 640px) { .who-grid { grid-template-columns: 1fr !important; } .enroll-card { padding: 28px 24px; } }
`;

