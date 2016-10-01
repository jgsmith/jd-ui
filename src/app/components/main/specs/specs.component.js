require('../../../services/api.service');
require('../../../services/specs.service');
require('../../../services/menu.service');

require('./breadcrumbs/breadcrumbs.component');
require('./spec/spec.component');
require('./specs2.component.jsx');
require('./specs.jsx');

require('./specs.scss');

require('../../../directives/sortable');

var jessdocs = require('jessdocs');
jessdocs.component('specs', {
    require: {
        parent: '^^main'
    },
     template: require('./specs.template.html'),
     controller: function(
        $anchorScroll,
        $location,
        $q, 
        $mdDialog,
        $api,
        BreadcrumbsService,
        $user,
        $specs,
        MenuService) {
        var self = this;
        
        self.export = false;
        self.exportSpecs = [];
        self.editingSpec;
        self.dragging = false;
        
        self.sortableOpts = {
          handle: '.drag-handle',
          group: '.spec-node',
          containerPath: '> spec > div',
          delay: 500,
          onDragStart: function($item, container, _super) {
            self.dragging = true;
            _super($item, container);
          },
          onDrop: function($item, container, _super) {
            self.dragging = false;
            var newIndex = $item.index();
            var specId = $item.attr('data-spec-id');
            var parentId = container.el.attr('data-parent-id');
            var prevId;
            if (newIndex > 0) {
                prevId = $item.prev().attr('data-spec-id');
            }
            $specs.move(specId, parentId, prevId);
            _super($item, container);
          }
        };
        
        self.toggleExport = (spec) => {
            var idx = self.exportSpecs.indexOf(spec);
            if (idx > -1) {
                recursiveCheck(spec, false);
            }
            else {
                recursiveCheck(spec, true);
            }
        };
        
        function recursiveCheck(spec, checked){
            var idx = self.exportSpecs.indexOf(spec);
            
            if (idx <= -1 && checked) {
                //if already in array, don't add twice
                self.exportSpecs.push(spec);
                spec.exporting = true;
            }
            else if (idx > -1 && !checked){
                self.exportSpecs.splice(idx, 1);
                spec.exporting = false;
            }
            
            spec.children.forEach( function(child){
                recursiveCheck(child, checked); 
            });
            
        }
        
       self.$onInit = function(){
           
           MenuService.addCallback( function(){
                self.addChildren = MenuService.addChildren;
                $location.hash('bottom');
                $anchorScroll();
           });
           
           MenuService.addExportCallback( function(){
               self.export = MenuService.export;
               if( self.export === false ){
                   MenuService.exportSpecs = self.exportSpecs;
                   self.exportSpecs = [];
               }
           });
           
           self.spec = $specs.specs;
           $specs.addCallback(function callback() {
                self.spec = $specs.specs;
            });
            
       };
        
        self.checked = function(spec){
            return _.includes(self.exportSpecs, spec);
        }
        
      self.move = (dragIndex, hoverIndex) => {
        
        const tempSpecArray = self.spec;
        
        const draggedSpec = tempSpecArray[dragIndex];
        
        let newIndex = hoverIndex;
        //if we are dragging down, subtract one
        if(dragIndex < hoverIndex){
          newIndex = newIndex + 1;
        }
        
        const prevSpec = tempSpecArray[newIndex-1]
        const afterSpec = tempSpecArray[newIndex]
        var indices = self.childIndices(dragIndex, tempSpecArray);
        
        //this is the only choice:
        //can't move stuff with depth > 0 to the very top
        //change it to depth 0
        if(!prevSpec && draggedSpec.ancestry_depth > 0){
          self.changeDepth(dragIndex, 0);
        }
        
        //this is not the only choice:
        // - we could be creating a sibling not a child
        //    but we'd have to look at the thing underneath
        //    but we could handle this in a different case...
        //if previous depth - dragged spec depth > 1 return
        //if the dragged thing is more than 1 indent deeper than
        //  the thing we are dragging under - change depth
        //  to create child
        if(prevSpec && (draggedSpec.ancestry_depth-prevSpec.ancestry_depth > 1)){
          self.changeDepth(dragIndex, prevSpec.ancestry_depth+1)
        }
        
        //this is the only choice:
        // (no indentation from here)
        //if top and dragged are equal depth, we need to
        // make sure bottom is not less than dragged depth
        if(prevSpec && (prevSpec.ancestry_depth === draggedSpec.ancestry_depth)){
          if(afterSpec && (afterSpec.ancestry_depth > prevSpec.ancestry_depth)){
            //if the bottom is less, indent dragged to be child
            //  of the one above
            self.changeDepth(dragIndex, prevSpec.ancestry_depth+1)
          }
        }
        
        //trying to put spec between two specs that are deeper than it:
        //  match depth of afterspec
        //  (can't do prev in case after is indented from prev)
        if(prevSpec && (prevSpec.ancestry_depth > draggedSpec.ancestry_depth)){
          if(afterSpec && (afterSpec.ancestry_depth > draggedSpec.ancestry_depth)){
            self.changeDepth(dragIndex, afterSpec.ancestry_depth)
          }
        }
        
        //remove everything [dragIndex, nextIndex)
        var draggedSpecs = _.pullAt(tempSpecArray, indices)
        
        //add dragged thing after hover index.. minus one?
        // because now we've removed a thing. but it 
        // might be over and it might be under...
        tempSpecArray.splice.apply(tempSpecArray, [hoverIndex, 0].concat(draggedSpecs))
        
        self.spec = tempSpecArray;
        return true;
      }
      
      self.changeDepth = (dragIndex, depth) => {
        const spec = self.spec[dragIndex];
        const difference = spec.ancestry_depth - depth;
        let children = self.children(dragIndex);
        _.map(children, function(child){
          child.ancestry_depth -= difference;
        });
        
        return children;
      };
      
      self.tryChangeDepth = (dragIndex, depthDelta) => {
        const spec = self.spec[dragIndex];
        const currentDepth = spec.ancestry_depth;
        const newDepth = _.max([0, spec.ancestry_depth+depthDelta])
        
        //get the specs before and after to check validity of position
        const prevSpec = self.spec[dragIndex-1];
        const childIndices = self.childIndices(dragIndex, self.spec);
        const nextSpec = self.spec[_.last(childIndices)+1];
        
        //if there is no previous spec, return. 
        // can't change depth if we are the topmost 
        if(!prevSpec){
          return;
        }
        
        const prevSpecDepth = prevSpec.ancestry_depth;
  
        //if no change
        if(newDepth === currentDepth){
          return;
        }
        
        //if we try to indent too far
        if(newDepth - prevSpecDepth > 1){
          return;
        }
        
        //don't create children - don't allow us to dedent
        //  far enough that our new depth is greater than
        //  the depth of the next spec that isn't our child
        if(nextSpec && newDepth < nextSpec.ancestry_depth){
          return;
        }
        
        self.changeDepth(dragIndex, newDepth)
      }
      
      self.childIndices = (index, array) => {
        //find the next spec at the same depth
        var dragged = array[index];
        const nextSpecs = _.drop(array, index+1)
        const nextSpec = _.find(nextSpecs, function(spec) {
            return spec.ancestry_depth <= dragged.ancestry_depth;
        });
        const nextIndex = nextSpec ? _.indexOf(array, nextSpec) : array.length;
        
        //index of everything [dragIndex, nextIndex)
        return _.range(index, nextIndex);
      };
      
      self.children = (index) => {
        var indices = self.childIndices(index, self.spec);
        return _.at(self.spec, indices);
      }
        
      self.toggleEdit = (spec) => {
        if(self.editingSpec){
          self.editingSpec.editing = false;
        }
        self.editingSpec = spec;
        spec.editing = true;
        spec.userMouseover = false;
      };
      
      self.saveEdit = (spec, description) => {
        if(spec.description !== description){
          spec.description = description;
          $specs.editDescription(spec);
        }
        spec.editing = false;
      }
      
      self.removeTag = (tag, spec) => {
        $specs.removeTag(tag, spec);
        _.pull(spec.tag_types, tag);
      };
      
      self.removeTicket = (ticket, spec) => {
        $specs.removeTicket(ticket);
        _.pull(spec.tickets, ticket);
      }
      
      var bookmark = (spec) => {
        spec.bookmarked = !spec.bookmarked;
        $specs.bookmark(spec);
      };
        
        self.favorite = function(name){
           return _.includes($user.user().user_setting.menu_favorites, name);
       };
       
      var setBreadCrumbs = (spec) => {
        BreadcrumbsService.setBreadcrumbs(spec);
      };
        
      var addChildren = (parent) => {
        $mdDialog.show({
          template: '<add-specs-modal spec="spec" layout="column"></add-specs-modal>',
          clickOutsideToClose: false,
          locals: {spec: parent },
          controller: function($scope, spec) {
              $scope.spec = spec;
          }
        });
      };
        
      var addTicket = (spec) => {
        var placeholder = $user.currentOrg().org_setting.tracker.link_format;
        var confirm = $mdDialog.prompt()
            .title('associate link')
            .placeholder(placeholder)
            .clickOutsideToClose('true')
            .ariaLabel('associate link')
            .ok('save')
            .cancel('cancel');
        $mdDialog.show(confirm).then(function(result) {
            $specs.addTicket(spec, result).then(function(ticket){
                spec.tickets.push(ticket);
            });
        }, function() {
        });
      };
        
      var deleteSpec = (spec) => {
        var confirm = $mdDialog.confirm()
          .title('Are you sure you want to delete this spec?')
          .textContent('This will also delete all children and tags')
          .ariaLabel('delete spec confirmation')
          .clickOutsideToClose('true')
          .ok('yes')
          .cancel('cancel');
        $mdDialog.show(confirm).then(function() {
            $specs.delete(spec)
        }, function() {
        });
      };
      
      var openTagModal = (spec) => {
        $mdDialog.show({
          template: '<tags-modal spec="spec" layout="column"></tags-modal>',
          clickOutsideToClose:true,
          locals: {spec: spec },
          controller: function($scope, spec) {
            $scope.spec = spec;
          }
        });
      };
      
      var comment = (spec) => {
        $mdDialog.show({
          template: '<comments-modal spec="spec" layout="column"></comments-modal>',
          clickOutsideToClose:true,
          locals: {spec: spec },
          controller: function($scope, spec) {
            $scope.spec = spec;
          }
        });
      };
      
      self.menu = [
        { name: 'tags',
          icon: 'label',
          clickFunction: openTagModal },
        { name: 'add children',
          icon: 'add',
          clickFunction: addChildren },
        { name: 'add link',
          icon: 'link',
          clickFunction: addTicket },
        { name: 'comments',
          icon: 'comment',
          clickFunction: comment },
        { name: 'expand',
          icon: 'fullscreen',
          clickFunction: setBreadCrumbs },
        { name: 'bookmark',
          icon: 'bookmark_border',
          clickFunction: bookmark },
        { name: 'unbookmark',
          icon: 'bookmark',
          clickFunction: bookmark },
        { name: 'delete',
          icon: 'delete',
          clickFunction: deleteSpec }
      ]
       
     }
});