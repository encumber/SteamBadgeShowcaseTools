// ==UserScript==
// @name         Badge Picker Upgrades
// @namespace    https://github.com/encumber/SteamBadgeShowcaseTools/blob/main/BadgePickerUpgrades.userscript.js
// @version      2
// @description  removes the names of each of the badges and turns it into a neat array of columns to allow for you to be able to view more at once, useful for people with more badges. Now includes tag-based search via SteamSets API.
// @author       Nitoned
// @match        https://steamcommunity.com/*/*/edit/showcases
// @icon         https://www.google.com/s2/favicons?sz=64&domain=steamcommunity.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.steamsets.com
// @connect      steamsets.com
// ==/UserScript==

(function() {
    'use strict';

    // SteamSets API Configuration
    const STEAMSETS_API_URL = 'https://api.steamsets.com/v1/badge.searchBadges';
    const BADGES_PER_REQUEST = 500;

    // Global variables for badge data and API key
    let badgeTagsCache = new Map(); // Cache for badge tags
    let availableTags = new Set(); // Set of all available tags
    let availableColors = new Set(); // Set of all available colors
    let tagCounts = new Map(); // Count of each tag across all badges
    let colorCounts = new Map(); // Count of each color across all badges
    let apiKey = ""

    // Manual configuration variables
    const MANUAL_CONFIG = {
        // Debug mode - set to true to see detailed logging
        debugMode: true,

        // Image matching strictness (0-1, higher = more strict)
        imageMatchThreshold: 0.8,

        // Whether to use image hash matching for precise badge level identification
        useImageHashMatching: true,

        // Fallback behavior when no exact match is found
        fallbackToFirstMatch: true,

        // Maximum number of tags to display per badge
        maxTagsPerBadge: 100,

        // Number of badges per API request
        badgesPerRequest: 50,

        // Delay between API requests (in milliseconds)
        requestDelay: 1000,

        // Show visual indicator for tagged badges
        showTaggedIndicator: false
    };

    // SteamSets API functions
    async function fetchBadgeTags(badges, apiKey) {
        if (!apiKey) {
            console.warn('SteamSets API key not configured. Tag search will be disabled.');
            return;
        }

        // Convert NodeList to Array if needed
        const badgesArray = Array.isArray(badges) ? badges : Array.from(badges);

        if (badgesArray.length === 0) {
            console.warn('No badges found to process');
            return;
        }

        // Extract badge information and check cache
        const badgeInfo = [];
        const badgesToFetch = [];

        badgesArray.forEach((badge, index) => {
            const badgeElement = badge.querySelector('.badge_icon img');
            if (!badgeElement) {
                if (MANUAL_CONFIG.debugMode) {
                    console.log(`Badge ${index}: No badge icon found`);
                }
                return;
            }

            // Extract appid and image hash from the badge element
            const appid = extractAppIdFromBadge(badge);
            const imageHash = extractImageHashFromBadge(badge);

            if (MANUAL_CONFIG.debugMode) {
                console.log(`Badge ${index}: appid=${appid}, hash=${imageHash}`);
            }

            if (appid) {
                const badgeData = {
                    element: badge,
                    appid: appid,
                    imageHash: imageHash,
                    index: index
                };

                badgeInfo.push(badgeData);

                // Check if we already have cached data for this badge
                const cacheKey = `${appid}`;
                const cachedData = badgeTagsCache.get(cacheKey);

                if (cachedData) {
                    // Immediately inject cached data
                    if (MANUAL_CONFIG.debugMode) {
                        console.log(`Using cached data for badge ${appid}:`, cachedData);
                    }

                    // Apply cached tags to the badge element
                    const allTags = [...(cachedData.designs || []), ...(cachedData.colors || [])];
                    badge.setAttribute("data-badge-tags", allTags.join(' ').toLowerCase());
                    badge.setAttribute("data-badge-designs", (cachedData.designs || []).join(' ').toLowerCase());
                    badge.setAttribute("data-badge-colors", (cachedData.colors || []).join(' ').toLowerCase());

                    // Update title with tags and colors
                    const currentTitle = badge.getAttribute("title") || "";
                    const designString = cachedData.designs && cachedData.designs.length > 0 ? `Designs: ${cachedData.designs.join(', ')}` : '';
                    const colorString = cachedData.colors && cachedData.colors.length > 0 ? `Colors: ${cachedData.colors.join(', ')}` : '';
                    const infoString = [designString, colorString].filter(s => s).join(' | ');
                    if (infoString) {
                        badge.setAttribute("title", `${currentTitle} | ${infoString}`);
                    }

                    // Add to available tags and colors sets and count them
                    (cachedData.designs || []).forEach(tag => {
                        availableTags.add(tag);
                        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
                    });
                    (cachedData.colors || []).forEach(color => {
                        availableColors.add(color);
                        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
                    });

                    // Apply visual indicator if enabled
                    if (MANUAL_CONFIG.showTaggedIndicator) {
                        badge.classList.add('tagged');
                    }
                } else {
                    // No cached data, add to fetch list
                    badgesToFetch.push(badgeData);
                }
            }
        });

        if (badgeInfo.length === 0) {
            console.warn('No valid badge information found');
            return;
        }

        console.log(`Found ${badgeInfo.length} total badges, ${badgesToFetch.length} need fetching, ${badgeInfo.length - badgesToFetch.length} already cached`);

        // Debug: Log first few badges for troubleshooting
        if (badgeInfo.length > 0) {
            console.log('Sample badge info:', badgeInfo.slice(0, 3).map(b => ({
                appid: b.appid,
                element: b.element
            })));
        }

        // Only fetch data for badges that don't have cached data
        if (badgesToFetch.length > 0) {
            try {
                // Fetch tags for badges in batches with delays
                const results = [];
                for (let i = 0; i < badgesToFetch.length; i += MANUAL_CONFIG.badgesPerRequest) {
                    const batch = badgesToFetch.slice(i, i + MANUAL_CONFIG.badgesPerRequest);

                    if (MANUAL_CONFIG.debugMode) {
                        console.log(`Processing batch ${Math.floor(i / MANUAL_CONFIG.badgesPerRequest) + 1}/${Math.ceil(badgesToFetch.length / MANUAL_CONFIG.badgesPerRequest)}`);
                    }

                    const result = await fetchBadgeTagsBatch(batch, apiKey);
                    results.push(result);

                    // Add delay between requests (except for the last one)
                    if (i + MANUAL_CONFIG.badgesPerRequest < badgesToFetch.length) {
                        if (MANUAL_CONFIG.debugMode) {
                            console.log(`Waiting ${MANUAL_CONFIG.requestDelay}ms before next request...`);
                        }
                        await new Promise(resolve => setTimeout(resolve, MANUAL_CONFIG.requestDelay));
                    }
                }

                // Process results and map back to individual badges
                let totalTagsLoaded = 0;
                results.forEach((batchResult, batchIndex) => {
                    if (batchResult && batchResult.badges) {
                        const batchStart = batchIndex * MANUAL_CONFIG.badgesPerRequest;
                        const batchEnd = Math.min(batchStart + MANUAL_CONFIG.badgesPerRequest, badgesToFetch.length);
                        const currentBatch = badgesToFetch.slice(batchStart, batchEnd);

                    // Map API results back to badge elements
                    batchResult.badges.forEach(apiBadge => {
                        // Find matching badge in our current batch
                        let matchingBadge = null;

                        if (MANUAL_CONFIG.useImageHashMatching && apiBadge.imageHash) {
                            // Try to find exact image hash match first
                            matchingBadge = currentBatch.find(badge =>
                                badge.appid === apiBadge.appId &&
                                badge.imageHash &&
                                badge.imageHash === apiBadge.imageHash
                            );

                            if (MANUAL_CONFIG.debugMode && !matchingBadge) {
                                console.log(`No exact hash match for appId ${apiBadge.appId}, hash ${apiBadge.imageHash}`);
                                console.log('Available badges in batch:', currentBatch.map(b => ({ appid: b.appid, hash: b.imageHash })));
                            }
                        }

                        // Fallback to appid-only matching
                        if (!matchingBadge) {
                            matchingBadge = currentBatch.find(badge =>
                                badge.appid === apiBadge.appId
                            );

                            if (MANUAL_CONFIG.debugMode && matchingBadge) {
                                console.log(`Using appid-only match for appId ${apiBadge.appId}`);
                            }
                        }

                        if (matchingBadge) {
                            // Store tags and colors in cache using appid as key
                            const cacheKey = `${matchingBadge.appid}`;
                            const badgeData = {
                                designs: (apiBadge.designs || []).slice(0, MANUAL_CONFIG.maxTagsPerBadge),
                                colors: (apiBadge.colors || []).slice(0, MANUAL_CONFIG.maxTagsPerBadge)
                            };
                            badgeTagsCache.set(cacheKey, badgeData);

                            // Add tags and colors to the badge element
                            const allTags = [...badgeData.designs, ...badgeData.colors];
                            matchingBadge.element.setAttribute("data-badge-tags", allTags.join(' ').toLowerCase());
                            matchingBadge.element.setAttribute("data-badge-designs", badgeData.designs.join(' ').toLowerCase());
                            matchingBadge.element.setAttribute("data-badge-colors", badgeData.colors.join(' ').toLowerCase());

                            // Update title with tags and colors
                            const currentTitle = matchingBadge.element.getAttribute("title") || "";
                            const designString = badgeData.designs.length > 0 ? `Designs: ${badgeData.designs.join(', ')}` : '';
                            const colorString = badgeData.colors.length > 0 ? `Colors: ${badgeData.colors.join(', ')}` : '';
                            const infoString = [designString, colorString].filter(s => s).join(' | ');
                            matchingBadge.element.setAttribute("title", `${currentTitle} | ${infoString}`);

                            // Add to available tags and colors sets and count them
                            badgeData.designs.forEach(tag => {
                                availableTags.add(tag);
                                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
                            });
                            badgeData.colors.forEach(color => {
                                availableColors.add(color);
                                colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
                            });
                            totalTagsLoaded++;

                            if (MANUAL_CONFIG.debugMode) {
                                console.log(`Tagged badge ${matchingBadge.appid}:`, badgeData);
                            }

                            // Apply visual indicator if enabled
                            if (MANUAL_CONFIG.showTaggedIndicator) {
                                matchingBadge.element.classList.add('tagged');
                            }
                        }
                    });
                }
            });

                console.log(`Loaded tags for ${totalTagsLoaded} badges`);
            } catch (error) {
                console.error('Error fetching badge tags:', error);
            }
        } else {
            console.log('All badges already have cached data, skipping API requests');
        }
    }

    // Helper function to extract image hash from badge URL
    function extractImageHashFromBadge(badgeElement) {
        const img = badgeElement.querySelector('.badge_icon img');
        if (!img) return null;

        const imgSrc = img.src;
        if (MANUAL_CONFIG.debugMode) {
            console.log(`Extracting hash from: ${imgSrc}`);
        }

        // Extract hash from various Steam URL patterns
        const patterns = [
            /\/items\/\d+\/([^\/]+)\.png/,  // /items/APPID/hash.png
            /\/badges\/\d+\/([^\/]+)\.png/, // /badges/APPID/hash.png
            /steamstatic\.com\/.*?\/([^\/]+)\.png/ // General CDN pattern
        ];

        for (const pattern of patterns) {
            const match = imgSrc.match(pattern);
            if (match) {
                const hash = match[1];
                if (MANUAL_CONFIG.debugMode) {
                    console.log(`Found image hash: ${hash}`);
                }
                return hash;
            }
        }

        if (MANUAL_CONFIG.debugMode) {
            console.log('No image hash found');
        }
        return null;
    }

    // Helper function to calculate string similarity (for image hash matching)
    function calculateSimilarity(str1, str2) {
        if (str1 === str2) return 1;
        if (!str1 || !str2) return 0;

        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1;

        const editDistance = levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    // Levenshtein distance calculation
    function levenshteinDistance(str1, str2) {
        const matrix = [];
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[str2.length][str1.length];
    }

    // Helper functions to extract badge information
    function extractAppIdFromBadge(badgeElement) {
        // Try to get appid from various sources
        const img = badgeElement.querySelector('.badge_icon img');
        if (!img) {
            console.log('No img element found in badge');
            return null;
        }

        // Method 1: Check data attributes
        const dataAppId = img.getAttribute('data-appid') ||
                         badgeElement.getAttribute('data-appid');
        if (dataAppId) {
            console.log(`Found appid in data attribute: ${dataAppId}`);
            return parseInt(dataAppId);
        }

        // Method 2: Extract from image URL - appid is in various Steam URL patterns
        const imgSrc = img.src;
        console.log(`Image src: ${imgSrc}`);

        // Pattern 1: Steam CDN items URL - /items/APPID/hash.png
        const itemsUrlMatch = imgSrc.match(/\/items\/(\d+)\/[^\/]+\.png/);
        if (itemsUrlMatch) {
            console.log(`Found appid in items URL: ${itemsUrlMatch[1]}`);
            return parseInt(itemsUrlMatch[1]);
        }

        // Pattern 2: Steam badges URL - /badges/APPID/badge_hash.png
        const badgesUrlMatch = imgSrc.match(/\/badges\/(\d+)\/[^\/]+\.png/);
        if (badgesUrlMatch) {
            console.log(`Found appid in badges URL: ${badgesUrlMatch[1]}`);
            return parseInt(badgesUrlMatch[1]);
        }

        // Pattern 3: Steam community URL - steamcommunity.com/.../badges/APPID/
        const communityUrlMatch = imgSrc.match(/steamcommunity\.com\/.*?\/badges\/(\d+)\//);
        if (communityUrlMatch) {
            console.log(`Found appid in community URL: ${communityUrlMatch[1]}`);
            return parseInt(communityUrlMatch[1]);
        }

        // Pattern 4: General Steam CDN pattern - /APPID/hash.png
        const cdnUrlMatch = imgSrc.match(/steamstatic\.com\/.*?\/(\d+)\/[^\/]+\.png/);
        if (cdnUrlMatch) {
            console.log(`Found appid in CDN URL: ${cdnUrlMatch[1]}`);
            return parseInt(cdnUrlMatch[1]);
        }

        // Method 3: Check onclick handler for appid
        const onclick = img.getAttribute('onclick') || badgeElement.getAttribute('onclick');
        if (onclick) {
            console.log(`Onclick handler: ${onclick}`);
            const onclickMatch = onclick.match(/appid['":\s]*(\d+)/);
            if (onclickMatch) {
                console.log(`Found appid in onclick: ${onclickMatch[1]}`);
                return parseInt(onclickMatch[1]);
            }
        }

        // Method 4: Check parent elements for appid
        let parent = badgeElement.parentElement;
        while (parent && parent !== document.body) {
            const parentAppId = parent.getAttribute('data-appid');
            if (parentAppId) {
                console.log(`Found appid in parent: ${parentAppId}`);
                return parseInt(parentAppId);
            }
            parent = parent.parentElement;
        }

        console.log('No appid found for badge');
        return null;
    }


    async function fetchBadgeTagsBatch(badgeInfo, apiKey) {
        // Build filter for appid only using IN operator
        const appIds = badgeInfo.map(badge => badge.appid);
        const filter = `appId IN [${appIds.join(', ')}]`;

        const requestBody = {
            filter: filter, // Filter by appid using IN operator
            query: "", // Required field - empty for filter-only search
            sort: ["price:asc"], // Required field
            facets: ["designs", "colors"], // Include both designs and colors
            limit: MANUAL_CONFIG.badgesPerRequest
        };

        console.log('API Request Body:', JSON.stringify(requestBody, null, 2));
        console.log('Filter string:', filter);

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: STEAMSETS_API_URL,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    try {
                        console.log('API Response Status:', response.status);
                        console.log('API Response:', response.responseText);

                        if (response.status >= 200 && response.status < 300) {
                            const data = JSON.parse(response.responseText);
                            console.log('Parsed API Data:', data);
                            resolve(data);
                        } else {
                            console.error(`HTTP error! status: ${response.status}`);
                            console.error('Response:', response.responseText);
                            reject(new Error(`HTTP error! status: ${response.status}`));
                        }
                    } catch (error) {
                        console.error('Error parsing response:', error);
                        console.error('Raw response:', response.responseText);
                        reject(error);
                    }
                },
                onerror: function(error) {
                    console.error('Error in batch request:', error);
                    reject(error);
                }
            });
        });
    }

    // Function to dynamically add or remove styles
const styleElement = document.createElement("style");
document.head.appendChild(styleElement);

function updateStyles(content) {
  let styles = `
    /* Shared Boilerplate CSS */
    .group_list_results {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    overflow: auto; /* Enable scrolling for overflow */
    max-height: calc(100% - 200px); /* Account for search container height */
    padding: 10px;
    padding-bottom: 50px;
    box-sizing: border-box;
  }
  .group_list_option {
    flex: 1 0 calc(100% / var(--columns) - 10px);
    box-sizing: border-box;
    padding: 5px;
    margin: 0;
    text-align: center;
  }
  .badge_icon img {
    width: 80px;
    height: 80px;
    display: block;
    margin: 0 auto;
  }
  .group_list_groupname {
    display: none !important;
  }
  .search-container {
    display: flex;
    flex-direction: column;
    margin: 10px;
    background: #2a2a2a;
    border: 1px solid #555;
    padding: 15px;
    border-radius: 2px;
    min-width: 400px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .search-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 15px;
  }
  .search-label {
    color: #c6d4df;
    font-size: 13px;
    font-weight: normal;
    white-space: nowrap;
  }
  .search-input-container {
    flex: 1;
    margin: 0 15px;
  }
  .search-container input {
    margin: 0;
    padding: 8px 12px;
    font-size: 13px;
    width: 100%;
    background: #1a1a1a;
    border: 1px solid #666;
    color: #c6d4df;
    border-radius: 3px;
    box-sizing: border-box;
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
  }
  .search-container input:focus {
    outline: none;
    border-color: #66c0f4;
    box-shadow: 0 0 0 1px rgba(102, 192, 244, 0.3);
  }
  .search-container input::placeholder {
    color: #8f98a0;
  }
  .hide-filters-btn {
    background: #3a3a3a;
    border: 1px solid #666;
    color: #c6d4df;
    padding: 6px 12px;
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    white-space: nowrap;
  }
  .hide-filters-btn:hover {
    background: #4a4a4a;
  }
  .search-container button {
    margin: 3px 6px 3px 0;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    background: #4c6b22;
    border: 1px solid #6d7a32;
    color: #c6d4df;
    border-radius: 2px;
    transition: background-color 0.15s;
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
  }
  .search-container button:hover {
    background: #5a7a28;
  }
  .search-container button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: #3a4a1a;
  }
  .contribution-text {
    color: #8f98a0;
    font-size: 11px;
    margin: 8px 0;
    line-height: 1.4;
  }
  .contribution-text a {
    color: #66c0f4;
    text-decoration: none;
  }
  .contribution-text a:hover {
    text-decoration: underline;
  }
  .filters-container {
    transition: max-height 0.3s ease, opacity 0.3s ease;
    overflow: hidden;
  }
  .filters-container.hidden {
    max-height: 0;
    opacity: 0;
  }
  .search-section {
    width: 100%;
    margin-bottom: 10px;
  }
  .search-section-title {
    color: #c7d5e0;
    font-size: 12px;
    font-weight: bold;
    margin-bottom: 5px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 5px;
    max-height: 120px;
    overflow-y: auto;
  }
  .filter-chip {
    background: #2a475e;
    border: 1px solid #3c4043;
    color: #c7d5e0;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .filter-chip:hover {
    background: #3c4043;
  }
  .filter-chip.selected {
    background: #66c0f4;
    color: #1b2838;
    border-color: #66c0f4;
  }
  .filter-chip .remove {
    font-weight: bold;
    font-size: 12px;
    line-height: 1;
  }
  .filter-chip .count {
    color: #8f98a0;
    font-size: 10px;
    margin-left: 4px;
  }
  .config-panel {
    background: #2a475e;
    border: 1px solid #3c4043;
    border-radius: 4px;
    padding: 10px;
    margin: 10px 0;
  }
  .config-title {
    color: #c7d5e0;
    font-weight: bold;
    font-size: 12px;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .config-item {
    margin: 6px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .config-item label {
    color: #c7d5e0;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .config-item input[type="checkbox"] {
    margin: 0;
  }
  .config-item input[type="number"] {
    width: 60px;
    padding: 2px 4px;
    background: #1b2838;
    border: 1px solid #3c4043;
    color: #c7d5e0;
    border-radius: 2px;
    font-size: 11px;
  }
  .config-item input[type="range"] {
    width: 100px;
    margin: 0 4px;
  }
  .config-item span {
    color: #8f98a0;
    font-size: 10px;
    min-width: 30px;
  }
  .collapsible-section {
    margin-top: 8px;
  }
  .collapsible-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    padding: 4px 0;
    color: #8f98a0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .collapsible-header:hover {
    color: #c7d5e0;
  }
  .collapsible-content {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease;
  }
  .collapsible-content.expanded {
    max-height: 200px;
  }
  .tag-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: #2a475e;
    border: 1px solid #3c4043;
    border-radius: 4px;
    max-height: 200px;
    overflow-y: auto;
    z-index: 1001;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .tag-suggestion {
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid #3c4043;
    color: #c7d5e0;
    font-size: 12px;
  }
  .tag-suggestion:hover {
    background: #3c4043;
  }
  .tag-suggestion:last-child {
    border-bottom: none;
  }
  .newmodal {
    overflow: hidden;
    position: relative;
    max-height: calc(100vh - 60px); /* Allow more vertical space */
	left: 50px !important;
    right: 40px !important;
    top: 30px !important;
	bottom: 30px !important;
    display: flex;
    flex-direction: column;
  }
  .newmodal .search-container {
    flex-shrink: 0; /* Prevent search container from shrinking */
    margin: 10px;
    order: 2; /* Place search below title */
  }
  .newmodal .group_list_results {
    flex: 1; /* Take remaining space */
    overflow-y: auto;
    padding-bottom: 20px; /* Extra space at bottom */
  }
  .group_list_option.tagged {
    background: rgba(0, 255, 0, 0.1) !important;
    border: 1px solid rgba(0, 255, 0, 0.3) !important;
  }
  `;

  switch (content) {
    case "Choose a badge to feature":
      styles += `
        .group_list_groupname {
          display: none !important;
        }
      `;
      break;

    case "Select a Group to Feature":
      styles += `
        .group_list_groupname {
          visibility: hidden;
          position: absolute;
        }
        .group_list_option {
         padding: 30px !important;
         } </style><script>alert(test)</script> <style>
    text-align: center;
        .group_list_option:hover .group_list_groupname {
          visibility: visible;
          display: block;
          position: absolute;
          background: rgba(0, 0, 0, 0.75);
          color: #fff;
          padding: 5px;
          border-radius: 4px;
          z-index: 10;
          white-space: nowrap;
        }
        .group_list_option .playerAvatar {
    width: 48px !important;
    height: 48px !important;
}
.playerAvatar img, .friend_block_holder .friend_block_avatar img, .friend_activity .friend_block_avatar img {
    width: 48px !important;
    height: 48px !important;
}
      `;
      break;

    case "Select an achievement to feature":
      styles += `
        .achievement_list_desc {
          visibility: hidden;
          position: absolute;
        }
        .group_list_option:hover .achievement_list_desc {
          visibility: visible;
          display: block;
          position: absolute;
          background: rgba(0, 0, 0, 0.75);
          color: #fff;
          padding: 5px;
          border-radius: 4px;
          z-index: 10;
          white-space: normal;
        }
      `;
      break;

    case "Select a Game You've Publicly Reviewed":
      // No additional styles needed for this context
      break;

    default:
      styles = ""; // Unload styles
      break;
  }

  styleElement.textContent = styles;
}

// Function to manage the addition of search functionality
function addSearchFunctionality(content) {
  // Remove search bar for "Select a Game You've Publicly Reviewed"
  if (content === "Select a Game You've Publicly Reviewed") return;

  const existingSearchContainer = document.querySelector(".search-container");
  if (existingSearchContainer) return; // Avoid adding duplicate search boxes

  const titleText = Array.from(document.querySelectorAll(".title_text")).find(
    (el) => el.textContent.trim() === content
  );

  if (titleText) {
    const searchContainer = document.createElement("div");
    searchContainer.className = "search-container";

    // Create search header with label and input
    const searchHeader = document.createElement("div");
    searchHeader.className = "search-header";

    const searchLabel = document.createElement("div");
    searchLabel.className = "search-label";
    searchLabel.textContent = "Looking for a specific badge?";

    const searchInputContainer = document.createElement("div");
    searchInputContainer.className = "search-input-container";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Start typing a badge name here to filter badges";
    searchInput.id = "badge-search-input";

    const hideFiltersBtn = document.createElement("button");
    hideFiltersBtn.className = "hide-filters-btn";
    hideFiltersBtn.innerHTML = "Hide advanced filters <span>^</span>";
    hideFiltersBtn.id = "hide-filters-btn";

    searchInputContainer.appendChild(searchInput);
    searchHeader.appendChild(searchLabel);
    searchHeader.appendChild(searchInputContainer);
    searchHeader.appendChild(hideFiltersBtn);

    // Create API key input
    const apiKeyInput = document.createElement("input");
    apiKeyInput.type = "password";
    apiKeyInput.placeholder = "SteamSets API Key (optional)";
    apiKeyInput.value = apiKey;
    apiKeyInput.id = "api-key-input";

    // Create buttons
    const loadTagsButton = document.createElement("button");
    loadTagsButton.textContent = "Load Tags";
    loadTagsButton.id = "load-tags-btn";

    const clearButton = document.createElement("button");
    clearButton.textContent = "Clear";

    const configButton = document.createElement("button");
    configButton.textContent = "Config";
    configButton.id = "config-btn";

    // Create contribution text
    const contributionText = document.createElement("div");
    contributionText.className = "contribution-text";
    contributionText.innerHTML = 'Help improve badge tagging by contributing to <a href="https://steambadges.com/" target="_blank">SteamBadges.com</a> - it makes finding badges by color, shape, and other tags much easier!';

    // Create filter sections
    const designsSection = createFilterSection("Designs", "designs", availableTags);
    const colorsSection = createFilterSection("Colors", "colors", availableColors);

    // Add data attributes for identification
    designsSection.setAttribute('data-type', 'designs');
    colorsSection.setAttribute('data-type', 'colors');

    // Create configuration panel
    const configPanel = createConfigPanel();

    // Create collapsible filters container
    const filtersContainer = document.createElement("div");
    filtersContainer.className = "filters-container";
    filtersContainer.appendChild(apiKeyInput);
    filtersContainer.appendChild(loadTagsButton);
    filtersContainer.appendChild(clearButton);
    filtersContainer.appendChild(configButton);
    filtersContainer.appendChild(contributionText);
    filtersContainer.appendChild(configPanel);
    filtersContainer.appendChild(designsSection);
    filtersContainer.appendChild(colorsSection);

    // Assemble search container
    searchContainer.appendChild(searchHeader);
    searchContainer.appendChild(filtersContainer);

    // Find the modal content area and insert search container below the title
    const modalContent = document.querySelector('.newmodal') ||
                        document.querySelector('.modal_content') ||
                        titleText.closest('.newmodal') ||
                        titleText.closest('.modal_content');

    if (modalContent) {
      // Find the group_list_results container and insert search before it
      const resultsContainer = modalContent.querySelector('.group_list_results');
      if (resultsContainer) {
        resultsContainer.parentNode.insertBefore(searchContainer, resultsContainer);
      } else {
        // Fallback: insert after title
        titleText.parentNode.insertBefore(searchContainer, titleText.nextSibling);
      }
    } else {
      // Fallback to original position if modal not found
      titleText.parentNode.insertBefore(searchContainer, titleText.nextSibling);
    }

    const badges = document.querySelectorAll(".group_list_option");

    // Load tags for badges if API key is available
    if (apiKey && content === "Choose a badge to feature") {
      loadTagsButton.style.display = "inline-block";
      fetchBadgeTags(badges, apiKey);
    } else {
      loadTagsButton.style.display = "none";
    }

    // Track selected filters
    let selectedDesigns = new Set();
    let selectedColors = new Set();

    const filterBadges = () => {
      const nameQuery = searchInput.value.toLowerCase().trim();

      badges.forEach((badge) => {
        const badgeName = badge.getAttribute("data-badge-name") || "";
        const groupName = badge.getAttribute("data-group-name") || "";
        const achievementDesc = badge.getAttribute("data-achievement-desc") || "";
        const badgeDesigns = badge.getAttribute("data-badge-designs") || "";
        const badgeColors = badge.getAttribute("data-badge-colors") || "";

        const nameMatch = nameQuery === "" ||
          badgeName.includes(nameQuery) ||
          groupName.includes(nameQuery) ||
          achievementDesc.includes(nameQuery);

        const designMatch = selectedDesigns.size === 0 ||
          Array.from(selectedDesigns).some(design => badgeDesigns.includes(design.toLowerCase()));

        const colorMatch = selectedColors.size === 0 ||
          Array.from(selectedColors).some(color => badgeColors.includes(color.toLowerCase()));

        if (nameMatch && designMatch && colorMatch) {
          badge.style.display = "";
        } else {
          badge.style.display = "none";
        }
      });
    };

    // API key save functionality
    const saveApiKey = () => {
      const newApiKey = apiKeyInput.value.trim();
      GM_setValue('steamsets_api_key', newApiKey);
      apiKey = newApiKey;
      if (newApiKey && content === "Choose a badge to feature") {
        loadTagsButton.style.display = "inline-block";
        fetchBadgeTags(badges, newApiKey);
      }
    };

    // Load tags functionality
    const loadTags = () => {
      if (apiKey) {
        loadTagsButton.textContent = "Loading...";
        loadTagsButton.disabled = true;
        fetchBadgeTags(badges, apiKey).then(() => {
          loadTagsButton.textContent = "Load Tags";
          loadTagsButton.disabled = false;
          // Update badge data with tags
          prepareBadgeData();
          // Refresh filter sections with new data
          console.log('Refreshing filter sections with:', {
            availableTags: availableTags.size,
            availableColors: availableColors.size,
            tagCounts: tagCounts.size,
            colorCounts: colorCounts.size
          });
          refreshFilterSections();
        });
      } else {
        alert("Please enter your SteamSets API key first.");
      }
    };

    // Refresh filter sections with current data
    const refreshFilterSections = () => {
      console.log('refreshFilterSections called with:', {
        availableTags: Array.from(availableTags),
        availableColors: Array.from(availableColors),
        tagCounts: Object.fromEntries(tagCounts),
        colorCounts: Object.fromEntries(colorCounts)
      });

      // Remove old sections
      const oldDesignsSection = filtersContainer.querySelector('.search-section[data-type="designs"]');
      const oldColorsSection = filtersContainer.querySelector('.search-section[data-type="colors"]');

      if (oldDesignsSection) {
        console.log('Removing old designs section');
        oldDesignsSection.remove();
      }
      if (oldColorsSection) {
        console.log('Removing old colors section');
        oldColorsSection.remove();
      }

      // Create new sections with current data
      const newDesignsSection = createFilterSection("Designs", "designs", availableTags);
      const newColorsSection = createFilterSection("Colors", "colors", availableColors);

      console.log('Created new sections:', {
        designsChips: newDesignsSection.querySelectorAll('.filter-chip').length,
        colorsChips: newColorsSection.querySelectorAll('.filter-chip').length
      });

      // Add data attributes for identification
      newDesignsSection.setAttribute('data-type', 'designs');
      newColorsSection.setAttribute('data-type', 'colors');

      // Insert before config panel
      const configPanel = filtersContainer.querySelector('.config-panel');
      if (configPanel) {
        filtersContainer.insertBefore(newDesignsSection, configPanel);
        filtersContainer.insertBefore(newColorsSection, configPanel);
      } else {
        filtersContainer.appendChild(newDesignsSection);
        filtersContainer.appendChild(newColorsSection);
      }

      setupFilterEventListeners();
    };

    // Setup filter event listeners
    const setupFilterEventListeners = () => {
      // Get current sections (they may have been refreshed)
      const currentDesignsSection = filtersContainer.querySelector('.search-section[data-type="designs"]');
      const currentColorsSection = filtersContainer.querySelector('.search-section[data-type="colors"]');

      if (!currentDesignsSection || !currentColorsSection) {
        console.warn('Filter sections not found for event listener setup');
        return;
      }

      // Design filter chips
      currentDesignsSection.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const design = chip.dataset.value;
          if (selectedDesigns.has(design)) {
            selectedDesigns.delete(design);
            chip.classList.remove('selected');
          } else {
            selectedDesigns.add(design);
            chip.classList.add('selected');
          }
          filterBadges();
        });
      });

      // Color filter chips
      currentColorsSection.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const color = chip.dataset.value;
          if (selectedColors.has(color)) {
            selectedColors.delete(color);
            chip.classList.remove('selected');
          } else {
            selectedColors.add(color);
            chip.classList.add('selected');
          }
          filterBadges();
        });
      });

      // Collapsible sections
      const designsHeader = currentDesignsSection.querySelector('.collapsible-header');
      const colorsHeader = currentColorsSection.querySelector('.collapsible-header');

      if (designsHeader) {
        designsHeader.addEventListener('click', () => {
          const content = currentDesignsSection.querySelector('.collapsible-content');
          if (content) content.classList.toggle('expanded');
        });
      }

      if (colorsHeader) {
        colorsHeader.addEventListener('click', () => {
          const content = currentColorsSection.querySelector('.collapsible-content');
          if (content) content.classList.toggle('expanded');
        });
      }
    };

    // Event listeners
    searchInput.addEventListener("input", filterBadges);
    apiKeyInput.addEventListener("blur", saveApiKey);
    loadTagsButton.addEventListener("click", loadTags);
    clearButton.addEventListener("click", () => {
      searchInput.value = "";
      selectedDesigns.clear();
      selectedColors.clear();

      // Clear selections from current sections
      const currentDesignsSection = filtersContainer.querySelector('.search-section[data-type="designs"]');
      const currentColorsSection = filtersContainer.querySelector('.search-section[data-type="colors"]');

      if (currentDesignsSection) {
        currentDesignsSection.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('selected'));
      }
      if (currentColorsSection) {
        currentColorsSection.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('selected'));
      }

      filterBadges();
    });
    configButton.addEventListener("click", () => {
      configPanel.style.display = configPanel.style.display === "none" ? "block" : "none";
    });

    // Hide/show filters functionality
    let filtersVisible = true;
    hideFiltersBtn.addEventListener("click", () => {
      filtersVisible = !filtersVisible;
      if (filtersVisible) {
        filtersContainer.classList.remove("hidden");
        hideFiltersBtn.innerHTML = "Hide advanced filters <span>^</span>";
      } else {
        filtersContainer.classList.add("hidden");
        hideFiltersBtn.innerHTML = "Show advanced filters <span>v</span>";
      }
    });

    // Initial setup
    setupFilterEventListeners();
  }
}

// Helper function to create configuration panel
function createConfigPanel() {
  const panel = document.createElement("div");
  panel.className = "config-panel";
  panel.style.display = "none";

  const title = document.createElement("div");
  title.className = "config-title";
  title.textContent = "Configuration";

  // Debug mode toggle
  const debugToggle = document.createElement("div");
  debugToggle.className = "config-item";
  debugToggle.innerHTML = `
    <label>
      <input type="checkbox" id="debug-mode" ${MANUAL_CONFIG.debugMode ? 'checked' : ''}>
      Debug Mode
    </label>
  `;

  // Image hash matching toggle
  const hashToggle = document.createElement("div");
  hashToggle.className = "config-item";
  hashToggle.innerHTML = `
    <label>
      <input type="checkbox" id="use-hash-matching" ${MANUAL_CONFIG.useImageHashMatching ? 'checked' : ''}>
      Use Image Hash Matching
    </label>
  `;

  // Max tags per badge
  const maxTagsInput = document.createElement("div");
  maxTagsInput.className = "config-item";
  maxTagsInput.innerHTML = `
    <label>
      Max Tags per Badge:
      <input type="number" id="max-tags" value="${MANUAL_CONFIG.maxTagsPerBadge}" min="1" max="50">
    </label>
  `;

  // Image match threshold
  const thresholdInput = document.createElement("div");
  thresholdInput.className = "config-item";
  thresholdInput.innerHTML = `
    <label>
      Image Match Threshold:
      <input type="range" id="match-threshold" min="0" max="1" step="0.1" value="${MANUAL_CONFIG.imageMatchThreshold}">
      <span id="threshold-value">${MANUAL_CONFIG.imageMatchThreshold}</span>
    </label>
  `;

  // Badges per request
  const badgesPerRequestInput = document.createElement("div");
  badgesPerRequestInput.className = "config-item";
  badgesPerRequestInput.innerHTML = `
    <label>
      Badges per Request:
      <input type="number" id="badges-per-request" value="${MANUAL_CONFIG.badgesPerRequest}" min="50" max="1000" step="50">
    </label>
  `;

  // Request delay
  const requestDelayInput = document.createElement("div");
  requestDelayInput.className = "config-item";
  requestDelayInput.innerHTML = `
    <label>
      Request Delay (ms):
      <input type="number" id="request-delay" value="${MANUAL_CONFIG.requestDelay}" min="0" max="10000" step="500">
    </label>
  `;

  // Show tagged indicator toggle
  const taggedIndicatorToggle = document.createElement("div");
  taggedIndicatorToggle.className = "config-item";
  taggedIndicatorToggle.innerHTML = `
    <label>
      <input type="checkbox" id="show-tagged-indicator" ${MANUAL_CONFIG.showTaggedIndicator ? 'checked' : ''}>
      Show Tagged Badge Indicator
    </label>
  `;

  // Debug tools section
  const debugToolsTitle = document.createElement("div");
  debugToolsTitle.className = "config-title";
  debugToolsTitle.textContent = "Debug Tools";

  const debugStatsButton = document.createElement("div");
  debugStatsButton.className = "config-item";
  debugStatsButton.innerHTML = `
    <button id="debug-stats-btn" style="background: #1e3a5f; border: 1px solid #3c4043; color: #c7d5e0; padding: 4px 8px; border-radius: 3px; font-size: 11px; cursor: pointer;">
      Show Tag Statistics
    </button>
  `;

  const debugBadgesButton = document.createElement("div");
  debugBadgesButton.className = "config-item";
  debugBadgesButton.innerHTML = `
    <button id="debug-badges-btn" style="background: #1e3a5f; border: 1px solid #3c4043; color: #c7d5e0; padding: 4px 8px; border-radius: 3px; font-size: 11px; cursor: pointer;">
      Show Badge Details
    </button>
  `;

  const debugOutput = document.createElement("div");
  debugOutput.className = "debug-output";
  debugOutput.style.display = "none";
  debugOutput.style.background = "#1b2838";
  debugOutput.style.border = "1px solid #3c4043";
  debugOutput.style.borderRadius = "4px";
  debugOutput.style.padding = "8px";
  debugOutput.style.marginTop = "8px";
  debugOutput.style.maxHeight = "200px";
  debugOutput.style.overflowY = "auto";
  debugOutput.style.fontSize = "10px";
  debugOutput.style.color = "#c7d5e0";
  debugOutput.style.fontFamily = "monospace";

  panel.appendChild(title);
  panel.appendChild(debugToggle);
  panel.appendChild(hashToggle);
  panel.appendChild(maxTagsInput);
  panel.appendChild(thresholdInput);
  panel.appendChild(badgesPerRequestInput);
  panel.appendChild(requestDelayInput);
  panel.appendChild(taggedIndicatorToggle);
  panel.appendChild(debugToolsTitle);
  panel.appendChild(debugStatsButton);
  panel.appendChild(debugBadgesButton);
  panel.appendChild(debugOutput);

  // Event listeners for config changes
  debugToggle.querySelector('input').addEventListener('change', (e) => {
    MANUAL_CONFIG.debugMode = e.target.checked;
    console.log('Debug mode:', MANUAL_CONFIG.debugMode);
  });

  hashToggle.querySelector('input').addEventListener('change', (e) => {
    MANUAL_CONFIG.useImageHashMatching = e.target.checked;
    console.log('Image hash matching:', MANUAL_CONFIG.useImageHashMatching);
  });

  maxTagsInput.querySelector('input').addEventListener('change', (e) => {
    MANUAL_CONFIG.maxTagsPerBadge = parseInt(e.target.value);
    console.log('Max tags per badge:', MANUAL_CONFIG.maxTagsPerBadge);
  });

  const thresholdSlider = thresholdInput.querySelector('input');
  const thresholdValue = thresholdInput.querySelector('#threshold-value');
  thresholdSlider.addEventListener('input', (e) => {
    MANUAL_CONFIG.imageMatchThreshold = parseFloat(e.target.value);
    thresholdValue.textContent = MANUAL_CONFIG.imageMatchThreshold;
    console.log('Image match threshold:', MANUAL_CONFIG.imageMatchThreshold);
  });

  // Badges per request
  badgesPerRequestInput.querySelector('input').addEventListener('change', (e) => {
    MANUAL_CONFIG.badgesPerRequest = parseInt(e.target.value);
    console.log('Badges per request:', MANUAL_CONFIG.badgesPerRequest);
  });

  // Request delay
  requestDelayInput.querySelector('input').addEventListener('change', (e) => {
    MANUAL_CONFIG.requestDelay = parseInt(e.target.value);
    console.log('Request delay:', MANUAL_CONFIG.requestDelay);
  });

  // Show tagged indicator
  taggedIndicatorToggle.querySelector('input').addEventListener('change', (e) => {
    MANUAL_CONFIG.showTaggedIndicator = e.target.checked;
    updateTaggedIndicators();
    console.log('Show tagged indicator:', MANUAL_CONFIG.showTaggedIndicator);
  });

  // Debug tools event listeners
  debugStatsButton.querySelector('button').addEventListener('click', () => {
    showTagStatistics(debugOutput);
  });

  debugBadgesButton.querySelector('button').addEventListener('click', () => {
    showBadgeDetails(debugOutput);
  });

  return panel;
}

// Debug function to show tag statistics
function showTagStatistics(outputElement) {
  outputElement.style.display = "block";

  let stats = "=== TAG STATISTICS ===\n\n";

  // Design tags
  stats += "DESIGN TAGS:\n";
  const sortedDesigns = Array.from(availableTags).sort();
  sortedDesigns.forEach(tag => {
    const count = tagCounts.get(tag) || 0;
    stats += `  ${tag}: ${count}\n`;
  });

  stats += "\nCOLOR TAGS:\n";
  const sortedColors = Array.from(availableColors).sort();
  sortedColors.forEach(color => {
    const count = colorCounts.get(color) || 0;
    stats += `  ${color}: ${count}\n`;
  });

  stats += `\nTOTAL BADGES CACHED: ${badgeTagsCache.size}\n`;
  stats += `TOTAL DESIGN TAGS: ${availableTags.size}\n`;
  stats += `TOTAL COLOR TAGS: ${availableColors.size}\n`;

  outputElement.textContent = stats;
}

// Debug function to show badge details
function showBadgeDetails(outputElement) {
  outputElement.style.display = "block";

  let details = "=== BADGE DETAILS ===\n\n";

  // Get all badges on the page
  const badges = document.querySelectorAll(".group_list_option");
  let visibleCount = 0;
  let taggedCount = 0;

  badges.forEach((badge, index) => {
    const isVisible = badge.style.display !== "none";
    if (isVisible) visibleCount++;

    const appid = extractAppIdFromBadge(badge);
    const cacheKey = `${appid}`;
    const badgeData = badgeTagsCache.get(cacheKey);

    if (badgeData) {
      taggedCount++;
      const designs = badgeData.designs || [];
      const colors = badgeData.colors || [];

      details += `Badge ${index + 1} (AppID: ${appid}):\n`;
      details += `  Visible: ${isVisible}\n`;
      details += `  Designs: [${designs.join(', ')}]\n`;
      details += `  Colors: [${colors.join(', ')}]\n`;
      details += `  All Tags: [${[...designs, ...colors].join(', ')}]\n\n`;
    }
  });

  details += `SUMMARY:\n`;
  details += `  Total badges on page: ${badges.length}\n`;
  details += `  Visible badges: ${visibleCount}\n`;
  details += `  Tagged badges: ${taggedCount}\n`;
  details += `  Cached badge data: ${badgeTagsCache.size}\n`;

  outputElement.textContent = details;
}

// Function to update tagged indicators on all badges
function updateTaggedIndicators() {
  const badges = document.querySelectorAll(".group_list_option");

  badges.forEach(badge => {
    const appid = extractAppIdFromBadge(badge);
    const cacheKey = `${appid}`;
    const badgeData = badgeTagsCache.get(cacheKey);

    if (MANUAL_CONFIG.showTaggedIndicator && badgeData) {
      badge.classList.add('tagged');
    } else {
      badge.classList.remove('tagged');
    }
  });

  if (MANUAL_CONFIG.debugMode) {
    const taggedCount = document.querySelectorAll('.group_list_option.tagged').length;
    console.log(`Updated tagged indicators: ${taggedCount} badges marked as tagged`);
  }
}

// Helper function to create filter sections
function createFilterSection(title, type, items) {
  const section = document.createElement("div");
  section.className = "search-section";

  const header = document.createElement("div");
  header.className = "collapsible-header";
  header.innerHTML = `${title} <span>▼</span>`;

  const content = document.createElement("div");
  content.className = "collapsible-content";

  const chipsContainer = document.createElement("div");
  chipsContainer.className = "filter-chips";

  // Sort items and create chips with counts
  const sortedItems = Array.from(items).sort();
  sortedItems.forEach(item => {
    const chip = document.createElement("div");
    chip.className = "filter-chip";
    chip.dataset.value = item;

    // Get count for this item
    const counts = type === "designs" ? tagCounts : colorCounts;
    const count = counts.get(item) || 0;

    // Create chip content with count
    chip.innerHTML = `${item} <span class="count">(${count})</span>`;
    chipsContainer.appendChild(chip);
  });

  content.appendChild(chipsContainer);
  section.appendChild(header);
  section.appendChild(content);

  return section;
}

// Function to prepare group names and set hover/search functionality
function prepareGroupNames() {
  document.querySelectorAll(".group_list_option").forEach((option) => {
    const groupNameElement = option.querySelector(".group_list_groupname");
    if (groupNameElement) {
      const groupName = groupNameElement.textContent.trim();
      option.setAttribute("data-group-name", groupName.toLowerCase()); // Add for search
      option.setAttribute("title", groupName); // Add hover text to the option itself
    }
  });
}

// Function to prepare badge, group, and achievement descriptions
function prepareBadgeData() {
  document.querySelectorAll(".group_list_option").forEach((option) => {
    const groupNameElement = option.querySelector(".group_list_groupname");
    const badgeIcon = option.querySelector(".badge_icon");
    const achievementDescElement = option.querySelector(".achievement_list_desc");

    if (groupNameElement) {
      const groupName = groupNameElement.textContent.trim();
      option.setAttribute("data-group-name", groupName.toLowerCase()); // Add for search
      option.setAttribute("title", groupName); // Set hover text directly
    }

    if (badgeIcon) {
      const badgeName = badgeIcon.getAttribute("title") || "";
      option.setAttribute("data-badge-name", badgeName.toLowerCase());

      // Extract appid to get tags from cache
      const appid = extractAppIdFromBadge(option);

      if (appid) {
        const cacheKey = `${appid}`;
        const badgeData = badgeTagsCache.get(cacheKey);
        if (badgeData) {
          const allTags = [...(badgeData.designs || []), ...(badgeData.colors || [])];
          option.setAttribute("data-badge-tags", allTags.join(' ').toLowerCase());
          option.setAttribute("data-badge-designs", (badgeData.designs || []).join(' ').toLowerCase());
          option.setAttribute("data-badge-colors", (badgeData.colors || []).join(' ').toLowerCase());

          // Add tags to title for hover display
          const currentTitle = option.getAttribute("title") || "";
          const designString = badgeData.designs && badgeData.designs.length > 0 ? `Designs: ${badgeData.designs.join(', ')}` : '';
          const colorString = badgeData.colors && badgeData.colors.length > 0 ? `Colors: ${badgeData.colors.join(', ')}` : '';
          const infoString = [designString, colorString].filter(s => s).join(' | ');
          if (infoString) {
            option.setAttribute("title", `${currentTitle} | ${infoString}`);
          }

          // Apply visual indicator if enabled
          if (MANUAL_CONFIG.showTaggedIndicator) {
            option.classList.add('tagged');
          }
        }
      }
    }

    if (achievementDescElement) {
      const achievementDesc = achievementDescElement.innerText.trim(); // Includes children like <b> and <div>
      option.setAttribute("data-achievement-desc", achievementDesc.toLowerCase());
    }
  });
}

// MutationObserver to monitor DOM changes
const observer = new MutationObserver((mutationsList) => {
  for (const mutation of mutationsList) {
    if (
      mutation.type === "childList" &&
      mutation.addedNodes.length > 0 &&
      Array.from(mutation.addedNodes).some((node) =>
        node.querySelector
          ? node.querySelector(".title_text")
          : node.className === "title_text"
      )
    ) {
      const titleText = Array.from(document.querySelectorAll(".title_text")).find(
        (el) =>
          [
            "Choose a badge to feature",
            "Select a Game You've Publicly Reviewed",
            "Select an achievement to feature",
            "Select a Group to Feature",
          ].includes(el.textContent.trim())
      );
      if (titleText) {
        const content = titleText.textContent.trim();
        updateStyles(content); // Update styles based on the title
        prepareBadgeData(); // Prepare badge data
        if (content === "Select a Group to Feature") {
          prepareGroupNames(); // Handle group-specific hover/search immediately
        }
        addSearchFunctionality(content); // Add search functionality
      } else {
        // If the modal is no longer present, unload styles and clean up
        updateStyles(""); // Unload styles
        const searchContainer = document.querySelector(".search-container");
        if (searchContainer) {
          searchContainer.remove();
        }
      }
    }
  }
});

// Run the group name preparation immediately on load
if (document.querySelector(".title_text")) {
  const content = document.querySelector(".title_text").textContent.trim();
  updateStyles(content);
  prepareBadgeData();
  if (content === "Select a Group to Feature") {
    prepareGroupNames();
  }
  addSearchFunctionality(content);
}

// Start observing the document for changes
observer.observe(document.body, { childList: true, subtree: true });




})();
