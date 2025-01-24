// ==UserScript==
// @name         Badge Picker Upgrades
// @namespace    https://raw.githubusercontent.com/encumber/SteamBadgeShowcaseTools/refs/heads/main/BadgePickerUpgrades.userscript.js
// @version      1.0
// @description  removes the names of each of the badges and turns it into a neat array of columns to allow for you to be able to view more at once, useful for people with more badges
// @author       Nitoned
// @match        https://steamcommunity.com/*/*/edit/showcases
// @icon         https://www.google.com/s2/favicons?sz=64&domain=steamcommunity.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

 // Add styles for layout, search box, and restricting badge overflow
const style = document.createElement("style");
style.textContent = `
  .group_list_results {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    overflow: auto; /* Enable scrolling for overflow */
    max-height: 90%; /* Ensure badges stay within the newmodal bounds */
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
    align-items: center;
    margin-bottom: 10px;
    position: absolute;
    top: 25px;
    right: calc(5%);
  }
  .search-container input {
    margin-left: 10px;
    padding: 5px;
    font-size: 14px;
  }
  .search-container button {
    margin-left: 5px;
    padding: 5px 10px;
    font-size: 14px;
    cursor: pointer;
  }
  .newmodal {
    overflow: hidden;
    position: relative;
    max-height: 100%; /* Restricts badges to fit within the modal */
	left: 50px !important;
    right: 40px !important;
	bottom: 40px !important;
  }
`;
document.head.appendChild(style);

// Function to add the search bar
function addSearchBar() {
  const existingSearchContainer = document.querySelector(".search-container");
  if (existingSearchContainer) return; // Avoid adding duplicate search boxes

  const titleText = Array.from(document.querySelectorAll(".title_text")).find(
    (el) => el.textContent.trim() === "Choose a badge to feature"
  );

  if (titleText) {
    const searchContainer = document.createElement("div");
    searchContainer.className = "search-container";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search badges...";

    const searchButton = document.createElement("button");
    searchButton.textContent = "Search";

    searchContainer.appendChild(document.createTextNode("Search:"));
    searchContainer.appendChild(searchInput);
    searchContainer.appendChild(searchButton);

    // Insert the search container next to the title_text element
    titleText.parentNode.insertBefore(searchContainer, titleText.nextSibling);

    // Add search functionality
    const badges = document.querySelectorAll(".group_list_option");

    const filterBadges = () => {
      const query = searchInput.value.toLowerCase().trim();
      badges.forEach((badge) => {
        const badgeName = badge.getAttribute("data-badge-name");
        if (query === "" || (badgeName && badgeName.includes(query))) {
          badge.style.display = ""; // Show badge
        } else {
          badge.style.display = "none"; // Hide badge
        }
      });
    };

    // Add event listeners
    searchButton.addEventListener("click", filterBadges);
    searchInput.addEventListener("input", filterBadges); // Real-time filtering
  }
}

// Extract badge names and set hover text
function prepareBadgeNames() {
  document.querySelectorAll(".group_list_option").forEach((option) => {
    const groupNameElement = option.querySelector(".group_list_groupname");
    const badgeIcon = option.querySelector(".badge_icon");
    if (groupNameElement && badgeIcon) {
      const badgeName = groupNameElement.textContent.trim();
      badgeIcon.setAttribute("title", badgeName); // Set hover text
      option.setAttribute("data-badge-name", badgeName.toLowerCase()); // Add searchable data attribute
      groupNameElement.remove(); // Remove the group name element
    }
  });
}

// Observer to detect "Choose a badge to feature"
const observer = new MutationObserver(() => {
  const titleText = Array.from(document.querySelectorAll(".title_text")).find(
    (el) => el.textContent.trim() === "Choose a badge to feature"
  );

  if (titleText) {
    prepareBadgeNames(); // Ensure badge names are ready
    addSearchBar(); // Add the search bar
  } else {
    // Remove the search bar if the text is no longer present
    const existingSearchContainer = document.querySelector(".search-container");
    if (existingSearchContainer) existingSearchContainer.remove();
  }
});

// Start observing the document for changes
observer.observe(document.body, { childList: true, subtree: true });



})();
