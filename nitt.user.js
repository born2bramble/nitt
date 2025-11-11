// ==UserScript==
// @name         Nomi Image Tags Tools
// @namespace    https://github.com/born2bramble
// @version      2.0
// @description  View tags and bulk edit from gallery page
// @author       born2bramble
// @homepageURL  https://github.com/born2bramble/nitt
// @match        https://beta.nomi.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nomi.ai
// @grant        none
// @run-at       document-idle
// @downloadURL  https://github.com/born2bramble/nitt/raw/refs/heads/main/nitt.user.js
// @updateURL    https://github.com/born2bramble/nitt/raw/refs/heads/main/nitt.user.js
// ==/UserScript==

/*
   TODO
   - Handle bulk delete view change
*/

(function () {
  'use strict';
  console.log('nitt init');
  if (window.nittInitialized) {
    console.log('Script already running, skipping...');
    return;
  }
  window.nittInitialized = true;

  /* Native thumbnail elements
   * We use this later to check if UI has loaded, track index of late-loading images */
  let thumbnailEls = false;

  const mediaUtils = {
    idPattern: /(?<=images\/).*(?=\.nl)|(?<=images\/).*(?=\.webp)|(?<=image-edit-requests\/).*(?=\/edited-image)|(?<=video-requests\/).*(?=\/preview)/,
    getType(url) {
      if (/image-edit-requests/.test(url)) {
        return "image-edit-requests";
      } else if (/video-requests/.test(url)) {
        return "video-requests";
      } else {
        return "selfie-images";
      }
    },
    getId(url) {
      const match = url.match(this.idPattern)
      /* This maybe isn't great, but deals with the match array and we are no worse off than default with null  */
      return match ? match[0] : null;
    },
    parse(url) {
      return {
        id: this.getId(url),
        type: this.getType(url)
      };
    }
  };

  const tagCache = {
    data: {},
    add(id, el, media, index, tags = []) {
      this.data[id] = {
        tagSet: new Set(tags),
        el: el,
        mediaType: media,
        index: index,
        get tags() { return Array.from(this.tagSet); }
      };
    },
    update(id, tags) {
      if (!this.data[id]) this.data[id] = {};
      this.data[id].tagSet = new Set(tags);
    },
    addTags: function (id, tags) {
      tags.forEach(tag => {
        this.data[id].tagSet.add(tag);
      });
    },
    removeTags: function (id, tags) {
      tags.forEach(tag => {
        this.data[id].tagSet.delete(tag);
      });
    },
    reset() {
      this.data = {}
    }
  };

  let view = {}
    /*
    thumbnailParent
    tagPreview
    tagPreviewList
    */
  function resetView(){
    Object.values(view).forEach(item => {
      Object.values(item).forEach(el => {
        el?.remove();
      })
    })
    view = {}
  }


  let state ={
    galleryModal: {
      isOpen: false,
      mediaType: undefined,
      mediaId: undefined,
      el: undefined,
      open(el, id, type) {
        this.isOpen = true;
        this.el = el;
        this.mediaId = id;
        this.mediaType = type;
      },
      close() {
        this.isOpen = false;
        this.el = undefined;
        this.mediaId = undefined;
        this.mediaType = undefined;
      },
      reset(){
        this.isOpen = false;
        this.el = undefined;
        this.mediaId = undefined;
        this.mediaType = undefined;
      }
    },
    existingTags: {
      list: {},
      async fetchTags() {
        this.list = await API.fetchTags();
        return this.list;
      },
      getTagId(tag) {
        return this.list.find(el => el.name == tag).uuid;
      },
      reset() {
        this.list= {}
      }
    },
    selectedImages: {
      ids: [],
      add(id) {
        if (!this.ids.includes(id)) {
          this.ids.push(id);
        }
      },
      remove(id) {
        if (this.ids.includes(id)) {
          this.ids = this.ids.filter(el => el != id);
        }
      },
      get count(){
        return this.ids.length
      },
      reset() {
            this.ids = []
      }
    },
    observers: {
      intersection: undefined,
      modalExists: undefined,
      modalChange: undefined,
      stopAll(){
        if (this.intersection) this.intersection.disconnect(); //just in case
        if (this.modalExists) this.modalExists.disconnect();
         if (this.modalChange) this.modalChange.disconnect();
      },
      reset() {
        this.stopAll();
        this.intersection = undefined;
        this.modalExists = undefined;
        this.modalChange = undefined;
      }
    },
    resetState(){
      this.galleryModal.reset();
      this.existingTags.reset();
      this.selectedImages.reset();
      this.observers.reset();
    }
  };
  let bulkSelectView = {
    selectorEls: [],
    byId: {},
    bulkAddButton: undefined,
    bulkRemoveButton: undefined,
    selectCount: undefined,
    selectCountText: undefined,
    mainParent: undefined,
    destroy() {
      this.selectorEls.forEach(el => el.remove());
      this.selectorEls = [];
    },
    reset() {
      this.destroy();
      if (this.mainParent) this.mainParent.remove();
      this.selectorEls = [];
      this.byId = {};
      this.bulkAddButton = undefined;
      this.bulkRemoveButton = undefined;
      this.selectCount = undefined;
      this.selectCountText = undefined;
      this.mainParent = undefined;
    }
  }

  const viewCheck = {
    album: new RegExp('\/(photo-album)'),
    isAlbum: function (url) {
      return this.album.test(url);
    }
  };

  if (viewCheck.isAlbum(document.URL)) {
    executeScript(document.URL);
  }

  window.navigation.addEventListener('navigate', (event) => {
    if (event.navigationType === 'replace') return; // Only fire for page navigation

    if (viewCheck.isAlbum(event.destination.url)) {
      thumbnailEls = false;
      state.resetState();
      tagCache.reset();
      bulkSelectView.reset();
      resetView();
      executeScript(event.destination.url);
    }
  });

  function executeScript(url) {
    console.log('init execute script');
    function checkIfLoaded() {
      thumbnailEls = getThumbnailEls();
      if (!thumbnailEls) return;
      if (window.getComputedStyle(thumbnailEls[thumbnailEls.length - 1]).background.match(/url\(".*\/api\//)) {
        addCss();
        createBulkEditUI();
        intersectionObserverSetup(thumbnailEls);
        modalExistsObserverSetup();
        clearInterval(intervalId);
        clearTimeout(timeoutId);
      }
    }

    const intervalId = setInterval(checkIfLoaded, 100);
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      console.warn("Stopped polling after timeout");
    }, 10000);
  }

  function getThumbnailEls() {
    const images = [...document.querySelectorAll('[aria-label^="Photo Number "] > div > div:first-child')];
    if (images.length == 0) return;
    return images;
  }


  /* -----------------------------+ API CALLS +------------------------- */
  const API = {
    async getTags(imageId, mediaType) {
    const res = await fetch(`https://beta.nomi.ai/api/${mediaType}/${imageId}/tags`);
    if (!res.ok) {
      console.warn(`Failed to fetch tags: ${res.status}`, {mediaType, imageId});
      return []; // ok for now i guess?
    }
    const jsonResult = await res.json();
    return jsonResult.tags.map(tagObj => tagObj.name);
  },
  async addTag(imageId, mediaType, tag) {
    const res = await fetch(`https://beta.nomi.ai/api/${mediaType}/${imageId}/tags`, {
      'headers': {
        'Content-Type': 'application/json'
      },
      'body': `{\"name\":\"${tag}\"}`,
      'method': 'POST',
    });
    if (!res.ok) throw new Error(`Failed ${res.status}. mediaType: ${mediaType}, imageID: ${imageId}`);
    return res.json();
  },

  async deleteTag(imageId, mediaType, tagId) {
    const res = await fetch(`https://beta.nomi.ai/api/${mediaType}/${imageId}/tags/${tagId}`, {
      'headers': {
        'Content-Type': 'application/json, text/plain, */*'
      },
      'method': 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed ${res.status}. mediaType: ${mediaType}, imageID: ${imageId}`);
    return res.json();
  },
   async fetchTags() {
      const res = await fetch(`https://beta.nomi.ai/api/media-tags?`);
      if (!res.ok) { throw new Error(`Failed ${res.status}.`); }
      const jsonResult = await res.json();
      return jsonResult.mediaTags;
    }
  }



  /* -----------------------------+ OBSERVERS +---------------------------- */
  /* Lazily get tag info */
  function intersectionObserverSetup(imgs) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const index = imgs.indexOf(el);
          const bgValue = window.getComputedStyle(el).background;
          const id = el.dataset.imageId == 'null' ? mediaUtils.getId(bgValue) : el.dataset.imageId;
          const mediaType = mediaUtils.getType(bgValue);

          if (id == "null") return;
          tagCache.add(id, el, mediaType, index);
          view[id] = {thumbnailParent: el};

          API.getTags(id, mediaType).then(results => {
            const tags = results;
            if (tags.length == 0) return;

            tagCache.update(id, tags);
            createTagPreview(id, el, index, tags);
          });
          observer.unobserve(el); // only once
        }
      });
    }, { scrollMargin: '200px' });

    imgs.forEach((el) => {
      el.dataset.imageId = mediaUtils.getId(window.getComputedStyle(el).background);
      observer.observe(el);
    });
    state.observers.intersection = observer;
  }

  /* Watch for image view modal open/close, so we can update tag data */
  function modalExistsObserverSetup() {

    const modalObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-floating-ui-portal')) {
            modalChangeObserverSetup(node);
          }
        });

        mutation.removedNodes.forEach((node) => {
          if (state.galleryModal.isOpen && node == state.galleryModal.el) {
            onModalClose();

              if (state.observers.modalChange) {
                  state.observers.modalChange.disconnect()
                  state.observers.modalChange = undefined;
              }
          }
        });
      });
    });

    modalObserver.observe(document.body, {
      childList: true, // Watch for added/removed children
      attributes: false,
      subtree: false // Don't watch deeper levels
    });

    state.observers.modalExists = modalObserver;
  }

  async function onModalClose() {
    const newTags = await API.getTags(state.galleryModal.mediaId, state.galleryModal.mediaType);
    const tagData = tagCache.data[state.galleryModal.mediaId];
    // if (!tagData) {
    //no change
    if (JSON.stringify(tagData.tags) === JSON.stringify(newTags)) return;

    if (tagData.tags.length > 0 && newTags.length == 0) {
      //all tags removed
      tagData.el.querySelector('.nitt__tag-preview')?.remove();
    } else if (tagData.tags.length == 0 && newTags.length > 0) {
      //fresh tags
      createTagPreview(state.galleryModal.mediaId, tagData.el, tagData.index, newTags);
    } else {
      //tags changed
      updateTagUI(state.galleryModal.mediaId, newTags)
    }

    tagCache.update(state.galleryModal.mediaId, newTags);
    state.galleryModal.close();
  }

  /* Watch for user arrowing through images in modal */
  function modalChangeObserverSetup(modal) {
    const modalContentObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type == 'attributes' && mutation.attributeName == 'src') {
          const mediaURL = modal.querySelector('[src]').getAttribute('src');
          const { id, type } = mediaUtils.parse(mediaURL);
          state.galleryModal.open(modal, id, type);
        }
      });
    });

    modalContentObserver.observe(modal, {
      childList: false,
      subtree: true,
      attributes: true
    });

    state.observers.modalChange = modalContentObserver;
  }

  function createTagPreview(id, el, i, tags) {
    if (el.querySelector('.nitt__tag-preview')) return;

    const tagEl = createElement('div', [['class', 'nitt__tag-preview']]);
    const input = createElement('input', [['type', 'checkbox'], ['id', `nitt__toggle${i + 1}`], ['name', 'Image tags']]);
    const label = createElement('label', [['for', `nitt__toggle${i + 1}`]]);
          label.insertAdjacentHTML('beforeEnd', '<span>🏷️</span>');
    const listWrapper = createElement('div', [['class', 'nitt__show-tags']]);
    const tagList = createElement('ul', [['class', 'nitt__tag-list']]);
          tagList.insertAdjacentHTML('beforeEnd', `<li>${tags.join('</li><li>')}</li>`)

    listWrapper.append(tagList);
    tagEl.append(input, label, listWrapper)
    el.append(tagEl);

    view[id].tagPreview = tagEl
    view[id].tagPreviewList = tagList

    /* Prevent click on tag icon from opening image view */
    tagEl.addEventListener('click', (evt) => {
      evt.stopPropagation();
    });
  }

  function updateTagUI(id, tags) {
    const tagList = view[id].tagPreviewList
    tagList.innerHTML = `<li>${tags.join('</li><li>')}</li>`
  }

  function createBulkEditUI() {
    if (document.querySelector('.nitt__bulk-tag-toggle')) return;

    const toggleEl = createElement('div', [['class', 'nitt__bulk-tag-toggle']]);

    /* Button to toggle multi-select state */
    const toggleButton = createElement('button',[['id', 'nitt__toggleBulkSelector'],['data-bulk-select-open', 'false']]);
    toggleButton.innerText = 'Select';
    toggleButton.addEventListener('click', (e) => {onBulkEditToggle(e)});

    const selectCountContainer = createElement('div', [['class', 'nitt__select-count-container']]);
    const selectCount = createElement('span', [['id', 'nitt__selectCount']]);
    const selectCountText = createElement('p', [['id', 'nitt__selectCountText']]);
    selectCountText.innerText = 'No photos selected';
    selectCountContainer.append(selectCount, selectCountText);

    /* Action buttons -- to perform on selected photos */
    const actionButtonAdd = createElement('button', [['id', 'nitt__addTags']]);
    actionButtonAdd.innerText = 'Add tags';
    actionButtonAdd.addEventListener('click', createAddTagDialog);

    const actionButtonRemove = createElement('button', [['id', 'nitt__removeTags']]);
    actionButtonRemove.innerText = 'Remove tags';
    actionButtonRemove.addEventListener('click', createRemoveTagDialog)

    /* Add elements to view object so we can access them easily later */
    bulkSelectView.mainParent = toggleEl;
    bulkSelectView.toggleButton = toggleButton;
    bulkSelectView.selectCountText = selectCountText;
    bulkSelectView.selectCount = selectCount;
    bulkSelectView.bulkAddButton = actionButtonAdd;
    bulkSelectView.bulkRemoveButton = actionButtonRemove;

    const buttonContainer = createElement('div', [['class', 'nitt__bulk-action-select']]);
    buttonContainer.append(actionButtonAdd, actionButtonRemove);

    toggleEl.append(toggleButton, selectCountContainer, buttonContainer);
    const parent = document.querySelector('div:has(> button[aria-label="Bulk Delete"])');
    parent.insertAdjacentElement('afterEnd', toggleEl);
  }

  function onBulkEditToggle(e) {
    let isActive = e.target.getAttribute('data-bulk-select-open') == 'true';
      if (isActive) {
        e.target.setAttribute('data-bulk-select-open', 'false');
        //destroy image selector elements
        bulkSelectView.destroy();
        bulkSelectView.toggleButton.innerText = 'Select';
      } else {
        e.target.setAttribute('data-bulk-select-open', 'true');
        createBulkImageSelectors();
        bulkSelectView.toggleButton.innerText = 'Cancel';
      }
  }

  /* Create elements that will allow us to select the thumbnails*/
  function createBulkImageSelectors() {
    const thumbnails = document.querySelectorAll('[aria-label^="Photo Number "]');
    const thumbnailSelectEls = [];

    thumbnails.forEach((thumbnail, i) => {
      let imageId = thumbnail.querySelector('[data-image-id]')?.getAttribute('data-image-id');
      if (imageId == 'null') {
        imageId = handleNullId(thumbnail.querySelector('[data-image-id]'));
      }
      const selectorEl = createElement('div', [['class', 'nitt__bulk-thumbnail-selector']]);
      const label = createElement('label', [['for', `nitt__bulk-tag-toggle-${i}`]]);
      const checkbox = createElement('input', [['type', 'checkbox'], ['id', `nitt__bulk-tag-toggle-${i}`], ['name', 'Bulk select'], ['value', `${imageId}`]]);
      checkbox.addEventListener('change', (e) => {onThumbnailSelect(imageId, e)})

      const selectorContent = `
            <div class="nitt__bulk-select-faux-input">
                    <svg viewBox="0 0 10 7" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="nitt__bulk-select-faux-input__check"><path d="M4 4.586L1.707 2.293A1 1 0 1 0 .293 3.707l3 3a.997.997 0 0 0 1.414 0l5-5A1 1 0 1 0 8.293.293L4 4.586z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>
                </div>
            `;

      label.append(checkbox);
      label.insertAdjacentHTML("beforeEnd", selectorContent);
      selectorEl.append(label);
      thumbnail.insertAdjacentElement("beforeEnd", selectorEl);

      selectorEl.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      thumbnailSelectEls.push(selectorEl);

      /* Add elements to view object for easy access later*/
      bulkSelectView[imageId] = {
        selectorEl,
        label,
        checkbox
      };
    });

    bulkSelectView.selectorEls = thumbnailSelectEls;
  }

  function onThumbnailSelect(imageId, e) {
    // not sure if this is actually necessary/would help
    if (imageId == 'null') {
      imageId = handleNullId(e.target);
    }
      if (e.target.checked) {
        state.selectedImages.add(imageId);
      } else {
        state.selectedImages.remove(imageId);
      }

      /* Update text showing count of selected images */
      updatePhotoCountText();
  }

  function updatePhotoCountText() {
    const photoCount = state.selectedImages.count;
      if (photoCount > 0) {
        bulkSelectView.selectCount.innerText = photoCount;
        const photoWord = photoCount == 1 ? "Photo" : "Photos";
        bulkSelectView.selectCountText.innerText = ` ${photoWord} selected`;
      } else if (photoCount == 0) {
        bulkSelectView.selectCount.innerText = "";
        bulkSelectView.selectCountText.innerText = "No photos selected";
      }
  }

  /* --------------------------+ ACTION DIALOGS +--------------------------- */
  async function createRemoveTagDialog() {
    state.existingTags.fetchTags();
    const dialog = createElement("dialog", [["id", "nitt__removeTagsDialog"], ["class", "nitt__dialog"]]);
    let tags = new Set([]);
    state.selectedImages.ids.forEach((el) => {
      tags = tags.union(tagCache.data[el].tagSet);
    });
    const optionsContainer = createElement("div", [["class", "nitt__remove-tags__options"]]);
    Array.from(tags).forEach((tag, i) => {
      let optionNumber = i + 1;
      const label = createElement("label", [["class", "nitt__remove-tags__option"], ["for", `nitt__tag-option-${optionNumber}`]]);
      const input = createElement("input", [["type", "checkbox"], ["id", `nitt__tag-option-${optionNumber}`], ["name", `${tag}`], ["value", `${tag}`]]);
            input.addEventListener("change", updateRemoveSummaryContent);
      const indicatorContainer = createElement("div", [["class", "nitt__remove-tags__remove-indicator-container"]]);
      const indicator = createElement("span", [["class", "nitt__remove-tags__remove-indicator"]]);
            indicator.innerText = "❌";
      indicatorContainer.append(indicator);
      const text = createElement("span", [["class", "nitt__remove-tags__tag-text"]]);
            text.innerText = tag;

      label.append(input, indicatorContainer, text);
      optionsContainer.append(label);
    });

    const summaryContainer = createElement("div", [["class", "nitt__remove-tags__summary"]]);
    const summaryText = document.createElement("p");
          summaryText.innerText = "No tags selected";
    const summaryTagsContainer = createElement("div", [["class", "nitt__remove-tags__summary-tags"], ["id", "nitt__removeTagSummary"]]);
          summaryContainer.append(summaryText, summaryTagsContainer);

    const photoWord = state.selectedImages.count== 1 ? "photo" : "photos";
    dialog.insertAdjacentHTML("beforeEnd", `<div class="nitt__remove-tags__instruct"><p>Choose tags to remove:</p></div>`);
    dialog.append(optionsContainer, summaryContainer, createDialogActions(dialog, removeTagsFromImages, `Remove tags from ${state.selectedImages.count} ${photoWord}`));
    document.body.insertAdjacentElement("beforeEnd", dialog);
    dialog.addEventListener('close', e => {
      dialog.remove();
    })
    dialog.showModal();
  }

  function updateRemoveSummaryContent() {
    const summaryParent = document.querySelector('#nitt__removeTagSummary');
    const summaryText = document.querySelector('.nitt__remove-tags__summary p');
    const selectedTags = document.querySelectorAll('[id^="nitt__tag-option-"]:checked');
    const summaryResult = [];
    selectedTags.forEach((el) => {
      summaryResult.push(`<span class="nitt__summary-tags__tag">${el.value}</span>`);
    });
    const selectedCount = selectedTags.length;
    if (selectedCount == 0) {
      summaryText.innerText = `No tags selected`;
    } else {
      const tagWord = selectedTags.length == 1 ? "tag" : "tags";
      summaryText.innerText = `${selectedCount} ${tagWord} selected for removal:`;
    }
    summaryParent.innerHTML = summaryResult.join(' ');
  }

  async function createAddTagDialog() {
    const dialog = createElement("dialog", [["id", "nitt__addTagsDialog"], ["class", "nitt__dialog"]]);
    const tagDatalist = createElement("datalist", [["id", "nitt__tagList"]]);

    let tags = await state.existingTags.fetchTags();
    tags.forEach((tag) => {
      const option = createElement("option", [["value", tag.name]]);
      tagDatalist.append(option);
    });

    const innerHTML = `<label for="nitt__addTagInput">Enter tag:</label> <input list="nitt__tagList" id="nitt__addTagInput" name="nitt__addTagInput" />`;
    const photoWord = state.selectedImages.count == 1 ? "photo" : "photos";
    dialog.insertAdjacentHTML("beforeEnd", innerHTML);
    dialog.append(tagDatalist, createDialogActions(dialog, addTagToImages, `Add tag to ${state.selectedImages.count} ${photoWord}`));

    document.body.insertAdjacentElement("beforeEnd", dialog);
    dialog.addEventListener('close', e => {
      dialog.remove();
    })
    dialog.showModal();
  }

  function createDialogActions(dialog, action, actionText) {
    const container = createElement("div", [["class", "nitt__dialog-control"]]);
    const closeButton = createElement("button", [["id", "nitt__dialogCloseButton"]]);
    const actionButton = createElement("button", [["id", "nitt__dialogActionButton"]]);
    closeButton.innerText = "Cancel";
    actionButton.innerText = actionText;

    closeButton.addEventListener("click", e => {
      dialog.close();
      dialog.remove();
    });

    actionButton.addEventListener("click", e => {
      action(state.selectedImages.ids).then(results => {
        state.selectedImages.ids.forEach(id => {
        const mediaType = tagCache.data[id].mediaType;
        API.getTags(id, mediaType).then(res => {
          const tags = res;
          tagCache.update(id, tags);
          updateAfterBulkEdit(id, tags);
        });
        })
      })

      dialog.close();
      dialog.remove();
    });

    container.append(closeButton, actionButton);
    return container;
  }

  async function addTagToImages(imageIds) {
    const tag = document.querySelector("#nitt__addTagInput").value;
    const imagesToTag = imageIds.filter(id => { !tagCache.data[id].tags.includes(tag); });

    const promises = imageIds.map(id =>
      API.addTag(id, tagCache.data[id].mediaType, tag)
    );
    return Promise.allSettled(promises);
  }

  async function removeTagsFromImages(imageIds) {
    const selectedTags = Array.from(document.querySelectorAll('[id^="nitt__tag-option-"]:checked'), el => el.value);
    const promises = [];

    imageIds.forEach(imageId => {
      selectedTags.forEach(tag => {
        if (!tagCache.data[imageId].tags.includes(tag)) return;
        if(tagCache.data[imageId].mediaType === "video-requests") return; //video api not working
        let tagId = state.existingTags.getTagId(tag);
        promises.push(API.deleteTag(imageId, tagCache.data[imageId].mediaType, tagId));
      });
    });
    return Promise.allSettled(promises);
  }

  function updateAfterBulkEdit(id, tags) {
        const image = tagCache.data[id];
        if (tags.length == 0) {
          view[id]?.tagPreview?.remove()
          delete view[id].tagPreview
          delete view[id].tagPreviewList
        } else if (view[id]?.tagPreviewList) {
          updateTagUI(id, tags)
        } else {
          createTagPreview(id, image.el, image.index, tags);
        }

      bulkSelectView.destroy();
      createBulkImageSelectors();
      state.selectedImages.reset();
      updatePhotoCountText();
  }


  function createElement(element, attributes) {
    let el = document.createElement(element);
    attributes.forEach(attribute => {
      el.setAttribute(attribute[0], attribute[1]);
    });
    return el;
  }

  function handleNullId(el) {
    const parent = el.closest("[aria-label^='Photo Number']");
    const image = parent.querySelector('[data-image-id]');
    const index = thumbnailEls.indexOf(image);
    const bgValue = window.getComputedStyle(image).background;
    const id = mediaUtils.getId(bgValue);

    /* I don't love this, but puts us back where we started so shouldnt break anything for the moment */
    if (!id) return 'null'

    image.setAttribute('data-image-id', id);
    const mediaType = mediaUtils.getType(bgValue);

    tagCache.add(id, image, mediaType, index);
    view[id] = {thumbnailParent: parent};

    API.getTags(id, mediaType).then(results => {
      const tags = results;
      if (tags.length == 0) return;
      tagCache.update(id, tags);
      createTagPreview(id, image, index, tags);
    });

    return id
  }

  function addCss() {
    if (document.querySelector('style#nitt__styles')) return;

    const newStyles = createElement('style', [['id', 'nitt__styles']]);
    newStyles.innerHTML = `
            [aria-label="Photo Number 1, Profile Picture"] .nitt__tag-preview {
                z-index: 2;
            }

            :where(.nitt__tag-preview) {
                --icon-bg:  var(--mantine-color-dark-filled, #3a3838);
                --icon-color: var(--mantine-color-purple-light-color, #cb48ff);
                --icon-bg--active: var(--icon-color);
                --icon-color--active: var(--icon-bg);

                position:absolute;
                max-width: 100%;
                bottom: 0;
                right: 0;
                z-index: 0;

                input {
                    /* remove the checkbox from flow */
                    position: absolute;
                    z-index:0;

                    /* hide it visually */
                    opacity: 0;

                    /* position with label (not really necessary but feels neater) */
                    bottom: 0;
                    right: 0;
                }

                label {
                    position: absolute;
                    z-index: 1;
                    bottom: 0;
                    right: 0;
                    display: grid;
                    align-content: center;
                    max-width: fit-content;
                    aspect-ratio: 1;
                    margin: 3px 2px;
                    border: 1px solid #5c5c5c9c;
                    border-radius: 50%;
                    background: var(--icon-bg);
                    font-size: 1rem;
                    line-height: 1;

                    span {
                        color: transparent;
                        background: var(--icon-color);
                        -webkit-background-clip: text;
                        background-clip: text;
                    }
                }

                /* Invert colours when tag display toggled on */
                :where(input:checked) + label {
                    border-color: #453650b5;
                    background: var(--icon-bg--active);

                    span {
                        background: var(--icon-color--active);
                        color: transparent;
                        -webkit-background-clip: text;
                        background-clip: text;
                    }
                }

                /* basic focus styles */
                :where(input:focus-visible) + label {
                    outline: 5px auto Highlight;
                    outline: 5px auto -webkit-focus-ring-color;
                    outline-offset: 1px;
                }

                .nitt__show-tags {
                    /* Hidden by default */
                    display: none;

                    position: relative;
                    width: 20rem;
                    max-width: 100%;
                    margin: 0;
                    padding: 5px 4px 4px;
                    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
                    border: 1px solid rgb(113 113 113 / 80%);
                    border-radius: 0 0 5px 5px; /* matches border-radius on images */
                    background: rgba(132, 132, 132, 0.6);
                    backdrop-filter: blur(9px);
                    -webkit-backdrop-filter: blur(9px);
                }

                .nitt__tag-list {
                    list-style: none;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 5px;
                    margin: 0;
                    padding: 0;
                    color: black;

                    /* individual tag styles */
                    :where(&) li {
                        padding: 3px;
                        border: 1px solid #ffffff63;
                        border-radius: 5px;
                        background: #ffffffb0;
                        font-size: .8rem;
                        line-height: 1;
                        font-weight: 500;

                        &:last-child {
                            margin-inline-end: 1.4rem;
                        }
                    }
                }

                /* Show tags on hover and click toggle */
                :where(input:checked + label, input:hover + label, label:hover) + .nitt__show-tags {
                    display: block;
                }
            }

            /* ----- Bulk tagging ----- */
            .nitt__bulk-tag-toggle {
                 margin-inline-end: auto;
                 justify-self: flex-start;
                 display: flex;
                 align-items: center;
                 display: grid;
    grid-template-areas:
        'toggle .'
        'count action';
    width: 100%;
    padding-inline: 16px;
    position: sticky;
    top: 0;
    z-index: 10;
    background: #1F222A;
    padding-block-end: 16px;
    grid-template-columns: 1fr auto;
            }

            .nitt__bulk-thumbnail-selector {
                position: absolute;
                z-index: 1;
                inset: 0;
                /* background-color: #ffc0cb42; */
                border-radius: 5px;
                /* opacity: .3; */
               /* outline: 3px white solid;*/

                    position: absolute;
    z-index: 1;
    inset: 0;

    border-radius: 5px;
    /* opacity: .3; */
    outline: 2px #ffffff8f solid;
    outline-offset: -2px;

                input { display: none; }
                 label {
                    inset: 0;
    position: absolute;
                 }
            }

            .nitt__bulk-select-faux-input {
                --checkbox-size-xs: calc(1rem * var(--mantine-scale));
    --checkbox-size-sm: calc(1.25rem * var(--mantine-scale));
    --checkbox-size-md: calc(1.5rem * var(--mantine-scale));
    --checkbox-size-lg: calc(1.875rem * var(--mantine-scale));
    --checkbox-size-xl: calc(2.25rem * var(--mantine-scale));
    --checkbox-size: var(--checkbox-size-sm);
    --checkbox-color: var(--mantine-primary-color-filled);
    --checkbox-icon-color: var(--mantine-color-white);
    position: relative;
    border: calc(.0625rem * var(--mantine-scale)) solid transparent;
    width: var(--checkbox-size);
    min-width: var(--checkbox-size);
    height: var(--checkbox-size);
    min-height: var(--checkbox-size);
    border-radius: var(--checkbox-radius, var(--mantine-radius-default));
    transition: border-color .1s ease, background-color .1s ease;
    cursor: var(--mantine-cursor-type);
    -webkit-tap-highlight-color: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--mantine-color-dark-6);
    border-color: var(--mantine-color-dark-1);
    border-width: 2px;
    border-radius: 5px 2px;
    }
        input:checked + .nitt__bulk-select-faux-input {
           background-color: var(--checkbox-color);
    border-color: var(--checkbox-color);
        }

        .nitt__bulk-select-faux-input__check {
            display: block;
    width: 60%;
    color: transparent;
    pointer-events: none;
    transform: translateY(calc(.3125rem * var(--mantine-scale))) scale(.5);
    opacity: 1;
    transition: transform .1s ease, opacity .1s ease;
        }

        input:checked + .nitt__bulk-select-faux-input > .nitt__bulk-select-faux-input__check {
        opacity: 1;
    transform: none;
    color: var(--checkbox-icon-color);
        }

        .nitt__tag-preview {
                z-index: 2;
            }
         [class^="PhotoAlbumFooter"] {
             z-index:3;
         }

         .nitt__bulk-thumbnail-selector:has(input:checked) {
    /*outline: 5px solid #b201ff;
    outline-offset: -6px;
    border: 2px solid #1f1f1f;*/
        backdrop-filter: brightness(.6);
    outline: 2px #7070708f solid;
    }
      #nitt__toggleBulkSelector {
        grid-area: toggle;
        width: 9ch;

        background: transparent;
        border-color: transparent;
        text-decoration: underline;
        text-underline-offset: 3px;
        color: var(--mantine-color-gray-2);
        padding: 0;
        margin: 0;
        width: fit-content;

        &:hover {
        color: var(--mantine-primary-color-light-color);
        }
        }
    .nitt__bulk-action-select {
    grid-area: action;
        display: flex;
        gap: 1rem;
        margin-inline-start: auto;
    /*visibility: hidden;*/
    display: none;

    button {
    border-radius: var(--mantine-radius-lg);
        border-style: solid;
        border-color: transparent;
        }
    }
    [data-bulk-select-open="true"] + div + .nitt__bulk-action-select {
    display: flex;
    visibility:visible;
    }
    [data-bulk-select-open="false"] + .nitt__select-count-container {
    /*visibility:hidden;*/
    display: none;
    }
    .nitt__select-count-container {
      grid-area: count;
      p {
        display: inline;
      }
    }

    nitt__remove-tags__options {
      max-width: fit-content;
      display: flex;
      flex-direction: column;
      gap: .25rem;
    }

    .nitt__remove-tags__option {
        display: grid;
        grid-template-columns: auto 1fr;
        grid-auto-rows: auto;
        padding: 2px;
        margin: 5px;
        width: fit-content;
        border: 1px solid transparent;
        border-radius: 4px;
    }
    .nitt__remove-tags__option:has(input:checked) {
    background-color: #6f1b1ba1;
    }
    .nitt__remove-tags__tag-text {
      padding-inline: 5px;
      border: 2px solid transparent;
        border-radius: 4px;
      width:fit-content;
    }
    .nitt__remove-tags__option input {
                        /* remove the checkbox from flow */
                        position: absolute;
                        z-index:0;

                        /* hide it visually */
                        opacity: 0;
                    }
    .nitt__remove-tags__remove-indicator {
        --icon-color: var(--mantine-color-dark-4);
        display: flex;
        font-size: .75rem;
        color: transparent;
        background: var(--icon-color);
        -webkit-background-clip: text;
        background-clip: text;
    }
    .nitt__remove-tags__option:hover {
    backdrop-filter: brightness(1.5);
        cursor: pointer;
    }

    .nitt__remove-tags__option:has(input:checked) .nitt__remove-tags__remove-indicator {
        --icon-color: indianred;
    }

    label.nitt__remove-tags__option:has(input:checked) .nitt__remove-tags__tag-text{
      /*  background-color: #6f1b1ba1; */
    }
    .nitt__dialog {
      display: flex;
        flex-direction: column;
        gap: .5rem;
        padding: 2rem;
        border-color: transparent;
        border-radius: 5px;
        box-shadow: rgba(0, 0, 0, 0.25) 0px 14px 28px, rgba(0, 0, 0, 0.22) 0px 10px 10px, rgba(0, 0, 0, 0.25) 0px 54px 55px, rgba(0, 0, 0, 0.12) 0px -12px 30px, rgba(0, 0, 0, 0.12) 0px 4px 6px, rgba(0, 0, 0, 0.17) 0px 12px 13px, rgba(0, 0, 0, 0.09) 0px -3px 5px;
    background-color: var(--mantine-color-dark-8);
    border-color: var(--mantine-color-dark-7);
    border-width: 1px;
    }
    .nitt__dialog::backdrop {
        backdrop-filter: brightness(0.5);

    }

    .nitt__dialog-control {
      display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 2rem;
    }
    .nitt__remove-tags__remove-indicator-container {
    aspect-ratio: 1;
        height: 80%;
        display: flex;
        align-items: center;
        justify-content: center;
        place-self: center;
        /*
        border: 2px solid var(--mantine-color-dark-3);
        border-radius: 4px;
        */
    }

    .nitt__remove-tags__option:has(input:checked) .nitt__remove-tags__remove-indicator-container {
    border-color:transparent;
    }

    .nitt__remove-tags__summary {
        backdrop-filter: brightness(0.75);
        padding: 1rem;
        min-height:90px;
        margin-block-start:1rem;
        p {
        margin-block: 0rem .5rem;
        }
    }

    .nitt__summary-tags__tag {
    padding-inline: 4px;
        background-color: var(--mantine-color-dark-7);
        display: inline-block;
        border-radius: 4px;
        line-height: 1.5;
    }

    .nitt__remove-tags__instruct p {
    margin-block: 0 .5rem;
    }

    #nitt__removeTagsDialog .nitt__dialog-control {
    margin-block-start: 1rem;
    }
    .nitt__bulk-tag-toggle:has([data-bulk-select-open="false"]) + div {
    margin-block-start: calc((1rem * var(--mantine-line-height)) + 4px);
    }
    .nitt__bulk-tag-toggle:has([data-bulk-select-open="true"]) + div {
    margin-block-start: 0;
    }
        `;
    document.head.insertAdjacentElement("beforeEnd", newStyles);
  }
})();
